// Pure rule functions. Each takes a rule context and returns raw items
// ({ type, date, summary, ref, detail, days_out? }) — priority and athlete
// fields are added by the assembler. No I/O here, so every rule is
// unit-testable with fixtures.
//
// Rule context (built by buildContext in index.js):
//   athlete      { id, name, status }
//   today        "YYYY-MM-DD" in the athlete's timezone
//   nowMs        epoch ms
//   sinceMs      epoch ms cutoff for "new"
//   sinceLocal   since as local "YYYY-MM-DDTHH:mm:ss"
//   darkLocal    now - DARK_HOURS as local string
//   horizonDays  integer
//   activities   slim activities, newest first
//   events       slim events
//   threads      { [activityId]: slim messages } — only fetched activities
import {
  COACH_ID,
  NEGATIVE_PATTERN,
  COMMENT_MAX_CHARS,
  DARK_HOURS,
  SILENT_ACTIVITY_COUNT,
  SUSPICIOUS_PLANNED_SECS,
  RIDE_TYPES,
  RUN_TYPES,
  SWIM_TYPES,
} from "./config.js"
import { dayOf, addDays, diffDays, weekdayIndex, weekdayName } from "./dates.js"

const SUMMARY_MAX = 120

function clip(text, max) {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…"
}

function activityLabel(a) {
  return `${a.type || "activity"}${a.name ? ` "${clip(a.name, 40)}"` : ""}`
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN)

// ── Comments ───────────────────────────────────────────────────────────────

export function classifyComment(text) {
  if (NEGATIVE_PATTERN.test(text)) return "comment_negative"
  if (text.includes("?")) return "comment_question"
  return "comment_positive"
}

// Unanswered = the last message from either the athlete or the coach is the
// athlete's, and it arrived at or after `since`. Third-party messages are
// ignored. All athlete messages after the coach's last reply are combined.
export function checkComments(ctx) {
  const items = []
  for (const a of ctx.activities) {
    const thread = ctx.threads[a.id]
    if (!thread?.length) continue
    const relevant = thread
      .filter((m) => m.athlete_id === ctx.athlete.id || m.athlete_id === COACH_ID)
      .sort((x, y) => ms(x.created) - ms(y.created))
    if (!relevant.length) continue
    const last = relevant[relevant.length - 1]
    if (last.athlete_id !== ctx.athlete.id) continue
    if (!(ms(last.created) >= ctx.sinceMs)) continue

    let i = relevant.length - 1
    while (i > 0 && relevant[i - 1].athlete_id === ctx.athlete.id) i--
    const tail = relevant.slice(i)
    const text = tail.map((m) => m.content).filter(Boolean).join("\n").trim()
    if (!text) continue

    const truncated = text.length > COMMENT_MAX_CHARS
    const detail = { comment: truncated ? text.slice(0, COMMENT_MAX_CHARS) : text }
    if (truncated) detail.truncated = true
    if (tail.length > 1) detail.messages = tail.length

    items.push({
      type: classifyComment(text),
      date: dayOf(a.start_date_local),
      summary: clip(`On ${activityLabel(a)}: ${text}`, SUMMARY_MAX),
      ref: { activity_id: a.id },
      detail,
    })
  }
  return items
}

// ── Athlete notes ──────────────────────────────────────────────────────────

// Any non-WORKOUT calendar entry (NOTE, HOLIDAY, SICK, INJURED…) the athlete
// created or edited since `since`.
export function isAthleteEntry(ev, athleteId) {
  return ev.created_by_id === athleteId && ev.category && ev.category !== "WORKOUT"
}

export function checkAthleteNotes(ctx) {
  return ctx.events
    .filter((ev) => isAthleteEntry(ev, ctx.athlete.id) && ms(ev.updated) >= ctx.sinceMs)
    .map((ev) => {
      const kind = ev.category === "NOTE" ? "note" : ev.category.toLowerCase()
      const detail = { category: ev.category }
      if (ev.description) detail.text = ev.description
      return {
        type: "athlete_note",
        date: dayOf(ev.start_date_local),
        summary: clip(`Athlete added ${kind} "${ev.name ?? ""}"${ev.for_week ? " (whole week)" : ""}`, SUMMARY_MAX),
        ref: { event_id: ev.id },
        detail,
      }
    })
}

// ── Empty days ─────────────────────────────────────────────────────────────

const REST_NAMES = new Set(["rest", "rest day"])
const ALWAYS_FILLS = new Set(["SICK", "INJURED"])

// Days (YYYY-MM-DD) that are not empty: a workout, a rest note, a race, an
// unavailable holiday, sickness/injury, or a completed activity (only matters
// for today). Whole-week events (for_week) never fill a single day.
export function filledDays(events, activities) {
  const filled = new Set()
  for (const ev of events) {
    if (ev.for_week) continue
    const start = dayOf(ev.start_date_local)
    if (!start) continue
    const cat = ev.category
    if (cat === "WORKOUT" || (cat && cat.startsWith("RACE"))) {
      filled.add(start)
    } else if (cat === "NOTE") {
      if (REST_NAMES.has((ev.name ?? "").trim().toLowerCase())) filled.add(start)
    } else if ((cat === "HOLIDAY" && ev.training_availability === "UNAVAILABLE") || ALWAYS_FILLS.has(cat)) {
      // end_date_local is exclusive (a one-day event ends at next midnight).
      const end = dayOf(ev.end_date_local)
      const last = end && end > start ? addDays(end, -1) : start
      for (let d = start; d <= last; d = addDays(d, 1)) filled.add(d)
    }
  }
  for (const a of activities) {
    const d = dayOf(a.start_date_local)
    if (d) filled.add(d)
  }
  return filled
}

export function checkEmptyDays(ctx) {
  const filled = filledDays(ctx.events, ctx.activities)
  const last = addDays(ctx.today, ctx.horizonDays)
  const empty = []
  for (let d = ctx.today; d <= last; d = addDays(d, 1)) {
    if (!filled.has(d)) empty.push(d)
  }
  if (!empty.length) return []

  const total = ctx.horizonDays + 1
  if (empty.length === total) {
    return [{
      type: "empty_week",
      date: ctx.today,
      days_out: 0,
      summary: `Nothing planned ${ctx.today} to ${last}`,
      ref: null,
      detail: { empty_days: total },
    }]
  }

  // Collapse fully-empty Mon–Sun weeks into one empty_week item each.
  const emptySet = new Set(empty)
  const items = []
  const consumed = new Set()
  for (const d of empty) {
    if (weekdayIndex(d) !== 0) continue
    const week = Array.from({ length: 7 }, (_, k) => addDays(d, k))
    if (week[6] <= last && week.every((x) => emptySet.has(x))) {
      week.forEach((x) => consumed.add(x))
      items.push({
        type: "empty_week",
        date: d,
        days_out: diffDays(d, ctx.today),
        summary: `Nothing planned ${d} to ${week[6]}`,
        ref: null,
        detail: { empty_days: 7 },
      })
    }
  }
  for (const d of empty) {
    if (consumed.has(d)) continue
    items.push({
      type: "empty_day",
      date: d,
      days_out: diffDays(d, ctx.today),
      summary: `No workout planned ${weekdayName(d)} ${d}`,
      ref: null,
      detail: { days_out: diffDays(d, ctx.today) },
    })
  }
  return items
}

// ── TBD placeholders ───────────────────────────────────────────────────────

function hasPlannedVolume(ev) {
  return ev.moving_time > 0 || ev.distance > 0 || ev.workout_doc_duration > 0
}

// Returns the reason a workout is a placeholder, or null.
export function tbdReason(ev) {
  if (ev.category !== "WORKOUT") return null
  if (ev.has_tbd_tag) return "#TBD in description"
  if (hasPlannedVolume(ev)) return null
  if (SWIM_TYPES.has(ev.type) && ev.mentions_meters) return null
  // Coach notes saved as "Other" workouts (add_or_update_event couldn't set
  // category) aren't placeholders.
  if (ev.type === "Other" && ev.created_by_id === COACH_ID) return null
  return "no planned duration or distance"
}

function upcomingWorkouts(ctx) {
  const last = addDays(ctx.today, ctx.horizonDays)
  return ctx.events.filter((ev) => {
    const d = dayOf(ev.start_date_local)
    return ev.category === "WORKOUT" && !ev.for_week && d && d >= ctx.today && d <= last
  })
}

export function checkTbd(ctx) {
  const workouts = upcomingWorkouts(ctx)
  const items = []
  for (const ev of workouts) {
    const reason = tbdReason(ev)
    if (!reason) continue
    const d = dayOf(ev.start_date_local)
    const detail = { name: ev.name, reason }
    const dup = workouts.some((o) => o !== ev && dayOf(o.start_date_local) === d && o.type === ev.type && !tbdReason(o))
    if (dup) detail.possible_duplicate = true
    items.push({
      type: "tbd",
      date: d,
      days_out: diffDays(d, ctx.today),
      summary: clip(`Placeholder ${ev.type || "workout"} "${ev.name ?? ""}"${dup ? " (built workout same day)" : ""}`, SUMMARY_MAX),
      ref: { event_id: ev.id },
      detail,
    })
  }
  return items
}

// ── Suspicious planned duration ────────────────────────────────────────────

export function checkSuspiciousDuration(ctx) {
  return upcomingWorkouts(ctx)
    .filter((ev) => !RIDE_TYPES.has(ev.type))
    .map((ev) => ({ ev, secs: Math.max(ev.moving_time || 0, ev.workout_doc_duration || 0) }))
    .filter(({ secs }) => secs > SUSPICIOUS_PLANNED_SECS)
    .map(({ ev, secs }) => {
      const hours = Math.round((secs / 3600) * 10) / 10
      return {
        type: "suspicious_duration",
        date: dayOf(ev.start_date_local),
        summary: clip(`${ev.type || "Workout"} "${ev.name ?? ""}" planned at ${hours} h; check the parsed description`, SUMMARY_MAX),
        ref: { event_id: ev.id },
        detail: { planned_hours: hours },
      }
    })
}

// ── Dark ───────────────────────────────────────────────────────────────────

// No activities (Strava stubs count), no athlete-created calendar entries and
// no athlete messages in the last DARK_HOURS.
export function checkDark(ctx) {
  const cutoffMs = ctx.nowMs - DARK_HOURS * 3600_000
  const recentActivity = ctx.activities.some((a) => a.start_date_local && a.start_date_local >= ctx.darkLocal)
  if (recentActivity) return []
  const recentEntry = ctx.events.some((ev) => isAthleteEntry(ev, ctx.athlete.id) && ms(ev.updated) >= cutoffMs)
  if (recentEntry) return []
  const recentMessage = Object.values(ctx.threads).some((t) =>
    t.some((m) => m.athlete_id === ctx.athlete.id && ms(m.created) >= cutoffMs))
  if (recentMessage) return []

  const lastDay = ctx.activities.map((a) => dayOf(a.start_date_local)).filter(Boolean).sort().pop() ?? null
  const daysDark = lastDay ? diffDays(ctx.today, lastDay) : null
  return [{
    type: "dark",
    date: lastDay,
    summary: lastDay
      ? `No activities or notes for ${daysDark} days (last activity ${lastDay})`
      : "No activities in the last 14 days",
    ref: null,
    detail: { days_dark: daysDark ?? ">14" },
  }]
}

// ── Silent ─────────────────────────────────────────────────────────────────

// None of the last SILENT_ACTIVITY_COUNT readable activities has a message
// from the athlete. Needs that many activities to judge; Strava stubs are
// skipped since their chats can't be read.
export function checkSilent(ctx) {
  const recent = ctx.activities.filter((a) => !a.is_stub).slice(0, SILENT_ACTIVITY_COUNT)
  if (recent.length < SILENT_ACTIVITY_COUNT) return []
  const anyComment = recent.some((a) => (ctx.threads[a.id] ?? []).some((m) => m.athlete_id === ctx.athlete.id))
  if (anyComment) return []
  return [{
    type: "silent",
    date: dayOf(recent[0].start_date_local),
    summary: `No comments from athlete on last ${SILENT_ACTIVITY_COUNT} activities`,
    ref: { activity_id: recent[0].id },
    detail: { activities: recent.map((a) => a.id) },
  }]
}

// ── Season bests ───────────────────────────────────────────────────────────

// ASSUMPTION (unverified against a real payload): icu_achievements is an array
// of objects with a `type` string naming the metric (contains POWER / PACE /
// HR|HEART) and `secs` for the effort duration. Anything that doesn't match
// that shape is ignored, so a wrong guess yields no items rather than noise.
const PR_SECS = new Set([1200, 1800, 3600])

function prKind(type) {
  const t = String(type ?? "").toUpperCase()
  if (t.includes("POWER")) return "power"
  if (t.includes("PACE")) return "pace"
  if (t.includes("HR") || t.includes("HEART")) return "hr"
  return null
}

function prAllowed(sport, kind, secs) {
  if (RIDE_TYPES.has(sport)) return (kind === "power" || kind === "hr") && PR_SECS.has(secs)
  if (RUN_TYPES.has(sport)) return (kind === "pace" || kind === "hr") && PR_SECS.has(secs)
  if (SWIM_TYPES.has(sport)) return kind === "pace" && secs === 1200
  return false
}

export function checkNewPr(ctx) {
  const items = []
  for (const a of ctx.activities) {
    if (a.is_stub || !a.icu_achievements) continue
    if (!(a.start_date_local >= ctx.sinceLocal)) continue
    const hits = a.icu_achievements
      .map((x) => ({ kind: prKind(x?.type), secs: Number(x?.secs), value: x?.value ?? x?.watts ?? null }))
      .filter((x) => x.kind && prAllowed(a.type, x.kind, x.secs))
    if (!hits.length) continue
    const label = hits.map((h) => `${h.secs / 60}min ${h.kind}`).join(", ")
    items.push({
      type: "new_pr",
      date: dayOf(a.start_date_local),
      summary: clip(`Season best on ${activityLabel(a)}: ${label}`, SUMMARY_MAX),
      ref: { activity_id: a.id },
      detail: { bests: hits },
    })
  }
  return items
}

// type -> rule function. empty_day covers empty_week; comments covers all three.
export const CHECKS = [
  { types: ["comment_negative", "comment_question", "comment_positive"], fn: checkComments },
  { types: ["athlete_note"], fn: checkAthleteNotes },
  { types: ["empty_day", "empty_week"], fn: checkEmptyDays },
  { types: ["tbd"], fn: checkTbd },
  { types: ["dark"], fn: checkDark },
  { types: ["silent"], fn: checkSilent },
  { types: ["new_pr"], fn: checkNewPr },
  { types: ["suspicious_duration"], fn: checkSuspiciousDuration },
]
