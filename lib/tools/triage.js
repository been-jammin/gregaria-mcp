import { z } from "zod"
import { ctx } from "./shared.js"
import { runTriage } from "../triage/index.js"
import { ITEM_TYPES, PRIORITIES } from "../triage/config.js"

export function registerTriageTools(server) {
  server.tool(
    "coaching_triage",
    "One-call coaching triage across the Active Roster. Returns ONE flat to-do list sorted by priority " +
      "(high, medium, low), not grouped by athlete: unanswered athlete comments (negative/question/positive), " +
      "athlete-created calendar notes, empty days/weeks and placeholder (TBD) workouts in the look-ahead, " +
      "athletes gone dark (3 days) or silent (no comments on last 4 activities), season bests, and " +
      "suspicious planned durations. Read-only. Use this first for triage; drill into single activities " +
      "with the detailed tools only when needed. 'skipped' lists anything that couldn't be checked.",
    {
      since: z.string().datetime({ offset: true }).optional()
        .describe("ISO datetime cutoff for new activities, comments and athlete notes. Default: now minus 24 hours."),
      horizon_days: z.number().int().min(1).max(28).optional()
        .describe("How many days ahead to scan the calendar (default 14)."),
      min_priority: z.enum(PRIORITIES).optional()
        .describe("Drop items below this priority (default low = keep everything)."),
      athlete_ids: z.array(z.string().regex(/^i\d+$/)).optional()
        .describe("Limit the scan to these athletes. Default: whole Active Roster."),
      include: z.array(z.enum(ITEM_TYPES)).optional()
        .describe("Only return these item types, e.g. [\"empty_day\", \"tbd\"]. Default: all."),
    },
    async (args, extra) => {
      const { apiKey } = ctx(extra)
      try {
        // Compact JSON (no pretty-print) keeps the response small.
        return { content: [{ type: "text", text: JSON.stringify(await runTriage(args, apiKey)) }] }
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] }
      }
    }
  )
}
