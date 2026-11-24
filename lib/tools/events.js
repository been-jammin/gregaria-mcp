import { addDays, format } from "date-fns"
import { z } from "zod"
import {
  getEvents,
  getActivities,
  getEventById,
  deleteEvent,
  deleteEventsByDateRange,
} from "../intervals/index.js"
import { ctx, run, resolveAthleteId, athleteIdArg } from "./shared.js"
import { handleAddOrUpdateEvent } from "./add-or-update-event.js"
import { buildAthleteCalendar } from "../events-slim.js"
import { createLimiter, withRetry, DEFAULT_TIMEZONE } from "../triage/fetch.js"
import { addDays as addDayStr } from "../triage/dates.js"
import { ROSTER } from "../triage/config.js"

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const SLIM_MAX_IN_FLIGHT = 4
const SLIM_MAX_DAYS = 42

async function getEventsSlim(args, apiKey) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: DEFAULT_TIMEZONE })
  const start = args.start || today
  const end = args.end || addDayStr(start, 14)
  if (end < start) throw new Error("end must be on or after start")
  if (addDayStr(start, SLIM_MAX_DAYS) < end) throw new Error(`Range is capped at ${SLIM_MAX_DAYS} days`)

  const ids = args.athlete_ids?.length ? args.athlete_ids : [resolveAthleteId(args)]
  // Completed work only exists up to today, so skip the activities call for future-only ranges.
  const actEnd = end < today ? end : today
  const wantActivities = args.include_completed !== false && start <= actEnd

  const limit = createLimiter(SLIM_MAX_IN_FLIGHT)
  const call = (fn) => limit(() => withRetry(fn))
  const names = new Map(ROSTER.map((r) => [r.id, r.name]))
  const errors = []

  const athletes = await Promise.all(ids.map(async (id) => {
    try {
      const [events, activities] = await Promise.all([
        call(() => getEvents(id, apiKey, { start, end })),
        wantActivities ? call(() => getActivities(id, apiKey, { start, end: actEnd })) : [],
      ])
      const cal = buildAthleteCalendar(id, events, activities, { categories: args.category })
      if (names.has(id)) cal.name = names.get(id)
      return cal
    } catch (e) {
      errors.push({ athlete: id, error: String(e?.message ?? e).slice(0, 200) })
      return { id, events: [] }
    }
  }))

  const out = { start, end, athletes }
  if (errors.length) out.errors = errors
  return out
}

const dateStr = () => format(new Date(), "yyyy-MM-dd")

function defaultEventRange({ start, end }) {
  return {
    start: start || dateStr(),
    end: end || format(addDays(new Date(), 30), "yyyy-MM-dd"),
  }
}

export function registerEventTools(server) {
  server.tool(
    "get_events",
    "Calendar events (planned workouts, notes, etc.) in a date range (default: today to +30 days).",
    {
      ...athleteIdArg,
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default today"),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default +30 days"),
    },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      return run(() => getEvents(resolveAthleteId(args), apiKey, defaultEventRange(args)))
    }
  )

  server.tool(
    "get_events_slim",
    "Compact calendar for one or more athletes: planned workouts, notes and holidays with only " +
      "coaching fields, and each completed workout attached as 'done' (compliance %, RPE 1-10, " +
      "feel 1-5 where 1=strong 5=weak, load, and power/HR/pace time-in-zone as % per zone, Z1 first; " +
      "'ss' = sweet spot %). 'unplanned' lists activities with no matching planned event. " +
      "Prefer this over get_events for scanning plans or reviewing a week. Default range: today to +14 days, max 42.",
    {
      ...athleteIdArg,
      athlete_ids: z.array(z.string().regex(/^i\d+$/)).max(20).optional()
        .describe("Several athletes in one call. Overrides athlete_id."),
      start: ymd.optional().describe("YYYY-MM-DD, default today"),
      end: ymd.optional().describe("YYYY-MM-DD, default start + 14 days"),
      category: z.array(z.enum(["WORKOUT", "NOTE", "HOLIDAY", "RACE_A", "RACE_B", "RACE_C"])).optional()
        .describe("Only return these event categories. Default: all."),
      include_completed: z.boolean().optional()
        .describe("Attach completed activities (default true). Set false for a plan-only scan."),
    },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      try {
        // Compact JSON (no pretty-print) keeps the response small.
        return { content: [{ type: "text", text: JSON.stringify(await getEventsSlim(args, apiKey)) }] }
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] }
      }
    }
  )

  server.tool(
    "get_event_by_id",
    "Detail of a single calendar event.",
    { ...athleteIdArg, event_id: z.string() },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      return run(() => getEventById(resolveAthleteId(args), args.event_id, apiKey))
    }
  )

  server.tool(
    "add_or_update_event",
    "Creates (or updates if event_id is passed) a calendar event: planned workout, note, etc. " +
      "Prefer 'workout_doc' over free-text 'description' for structured workouts: Intervals parses " +
      "'description' into steps server-side, and that parser is confirmed silently lossy in some " +
      "cases (a step keeps its duration but loses its power target; repetition headers written with " +
      "a leading '-' collapse to 1 rep) — root cause not fully pinned down, so it can't be avoided by " +
      "text formatting alone. Returns {event, warnings, verification} — NOT the bare event object. " +
      "'warnings' are local pre-flight heuristics on 'description' (best-effort, not a reliable " +
      "predictor either way); 'verification' diffs the response against what was requested and is the " +
      "authoritative signal — check verification.status before trusting the write.",
    {
      ...athleteIdArg,
      name: z.string(),
      category: z.enum(["WORKOUT", "NOTE"]).optional()
        .describe("WORKOUT (default) for a planned session, NOTE for a calendar note (coach message, rest day, etc.). Notes don't need workout_type and their description isn't parsed into steps."),
      for_week: z.boolean().optional()
        .describe("NOTE only: true makes it a whole-week note (put start_date on the Monday) instead of a single-day note."),
      workout_type: z.string().optional().describe("e.g. 'Ride', 'Run', 'Swim', 'Walk', 'Row'. Required when category is WORKOUT."),
      event_id: z.string().optional().describe("If passed, updates the existing event instead of creating a new one"),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default today"),
      description: z.string().optional()
        .describe("Free-form text description. If it encodes workout steps, prefer 'workout_doc' instead — this field goes through Intervals' text parser, which is silently lossy (see tool description)."),
      workout_doc: z.record(z.string(), z.any()).optional()
        .describe("Structured workout object (steps, etc.), sent as-is to Intervals' 'workout_doc' field. Preferred over 'description' for workouts: it bypasses the lossy text parser entirely."),
      moving_time: z.number().int().positive().optional().describe("Expected duration in seconds"),
      distance: z.number().int().positive().optional().describe("Expected distance in meters"),
      strict: z.boolean().optional().default(false)
        .describe("If true, abort without writing when the local pre-flight check of 'description' finds warnings. Ignored when 'workout_doc' is given directly."),
    },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      return run(() => handleAddOrUpdateEvent(args, apiKey))
    }
  )

  server.tool(
    "delete_event",
    "PERMANENTLY deletes a calendar event. Only use if the user explicitly confirmed they want to delete that event.",
    { ...athleteIdArg, event_id: z.string() },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      return run(async () => {
        await deleteEvent(resolveAthleteId(args), args.event_id, apiKey)
        return { deleted: args.event_id }
      })
    }
  )

  server.tool(
    "delete_events_by_date_range",
    "PERMANENTLY deletes all calendar events in a date range. Only use if the user explicitly confirmed the range to delete — there's no undo.",
    {
      ...athleteIdArg,
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
    },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      return run(() =>
        deleteEventsByDateRange(resolveAthleteId(args), apiKey, {
          start: args.start_date,
          end: args.end_date,
        })
      )
    }
  )
}
