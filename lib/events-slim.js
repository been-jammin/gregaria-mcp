// Pure mappers for get_events_slim: cut raw Intervals events and activities
// down to what a coach reads, and join completed activities onto the planned
// events they were paired with. No I/O here, so it's all unit-testable.
import { COACH_ID } from "./triage/config.js"

const DESC_MAX = 200

// tp2intervals appends "- - - -\nImported with tp2intervals ... trainingPeaksId=..."
// to every imported description. It's noise for coaching, so drop it.
const TP2I_TAIL = /\n?\s*(?:-\s){3}-?\s*\n?\s*Imported with tp2intervals[\s\S]*$/i
const TP2I_ONLY = /\n?\s*Imported with tp2intervals[\s\S]*$/i

export function cleanDescription(d) {
  if (!d) return undefined
  const s = String(d).replace(TP2I_TAIL, "").replace(TP2I_ONLY, "").replace(/\s+/g, " ").trim()
  if (!s) return undefined
  return s.length > DESC_MAX ? s.slice(0, DESC_MAX) + "…" : s
}

const round = (n, dp = 0) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// Zone times → percent of total time in zones, one entry per zone (Z1 first).
// Accepts both shapes Intervals uses: [secs, secs, ...] (HR, pace) and
// [{id: "Z1", secs}, ..., {id: "SS", secs}] (power). Sweet spot overlaps
// Z3/Z4, so it's reported separately rather than counted in the total.
// Trailing zero zones are trimmed. Returns undefined when there's no data.
export function zonePercents(zones) {
  if (!Array.isArray(zones) || !zones.length) return undefined
  let secs = []
  let sweetSpot = 0
  for (const z of zones) {
    if (typeof z === "number") secs.push(z)
    else if (z && typeof z === "object") {
      if (z.id === "SS") sweetSpot = z.secs || 0
      else secs.push(z.secs || 0)
    }
  }
  const total = secs.reduce((a, b) => a + b, 0)
  if (!total) return undefined
  const pct = secs.map((s) => round((100 * s) / total))
  while (pct.length && pct[pct.length - 1] === 0) pct.pop()
  const out = { pct }
  if (sweetSpot) out.ss = round((100 * sweetSpot) / total)
  return out
}

// Completed-activity summary. Keys stay short because this repeats once per
// workout across the whole roster.
export function slimActivity(a) {
  const out = { aid: String(a.id) }
  if (a.source === "STRAVA") {
    // Strava-sourced activities come back as empty stubs via the API.
    out.stub = true
    if (a.start_date_local) out.date = String(a.start_date_local).slice(0, 10)
    return out
  }
  if (a.start_date_local) out.date = String(a.start_date_local).slice(0, 10)
  if (a.type) out.sport = a.type
  if (a.name) out.name = a.name
  if (a.moving_time) out.min = Math.round(a.moving_time / 60)
  if (a.distance) out.m = Math.round(a.distance)
  if (a.icu_training_load != null) out.load = a.icu_training_load
  if (a.compliance != null) out.comp = round(a.compliance)
  if (a.icu_rpe != null) out.rpe = a.icu_rpe
  if (a.feel != null) out.feel = a.feel
  if (a.average_heartrate) out.avg_hr = a.average_heartrate
  if (a.icu_average_watts) out.avg_w = a.icu_average_watts
  const pwr = zonePercents(a.icu_zone_times)
  const hr = zonePercents(a.icu_hr_zone_times)
  const pace = zonePercents(a.use_gap_zone_times ? a.gap_zone_times : a.pace_zone_times)
  if (pwr) out.pwr_z = pwr
  if (hr) out.hr_z = hr
  if (pace) out.pace_z = pace
  if (Array.isArray(a.icu_achievements) && a.icu_achievements.length) out.pb = a.icu_achievements.length
  if (a.icu_chat_id) out.chat = true
  return out
}

export function slimEvent(e, athleteId) {
  const secs = e.moving_time || e.workout_doc?.duration || 0
  const dist = e.distance || e.workout_doc?.distance || 0
  const out = {
    id: e.id,
    date: String(e.start_date_local).slice(0, 10),
    cat: e.category,
  }
  if (e.type) out.sport = e.type
  if (e.name) out.name = e.name
  if (secs) out.min = Math.round(secs / 60)
  if (dist) out.m = Math.round(dist)
  const desc = cleanDescription(e.description)
  if (desc) out.desc = desc
  if (e.created_by_id === athleteId) out.by = "athlete"
  else if (e.created_by_id && e.created_by_id !== COACH_ID) out.by = e.created_by_id
  if (e.for_week) out.for_week = true
  if (e.training_availability && e.training_availability !== "NORMAL") out.avail = e.training_availability
  return out
}

// Builds one athlete's slim calendar: planned events with their completed
// activity attached as `done`, plus activities that matched no event in
// `unplanned`. Sorted by date.
export function buildAthleteCalendar(athleteId, rawEvents, rawActivities, { categories } = {}) {
  const cats = categories?.length ? new Set(categories) : null
  const byEvent = new Map()
  const unpaired = []
  for (const a of rawActivities || []) {
    if (a.paired_event_id != null) byEvent.set(String(a.paired_event_id), a)
    else unpaired.push(a)
  }

  const events = []
  for (const e of rawEvents || []) {
    const paired = byEvent.get(String(e.id))
    if (paired) byEvent.delete(String(e.id))
    if (cats && !cats.has(e.category)) continue
    const s = slimEvent(e, athleteId)
    if (paired) s.done = slimActivity(paired)
    events.push(s)
  }
  // Activities paired to an event outside the window still count as done work.
  const unplanned = [...unpaired, ...byEvent.values()].map(slimActivity)

  const byDate = (a, b) => String(a.date).localeCompare(String(b.date))
  events.sort(byDate)
  unplanned.sort(byDate)
  const out = { id: athleteId, events }
  if (unplanned.length) out.unplanned = unplanned
  return out
}
