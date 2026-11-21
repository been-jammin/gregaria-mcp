// Test fixtures shaped like real Intervals payloads (already slimmed).
import { slimActivity, slimEvent } from "./slim.js"
import { toLocal } from "./dates.js"

export const TZ = "America/Toronto"
export const COACH = "i782141"
export const JACKY = { id: "i799428", name: "Jacky Janelle", status: "active" }
export const HOLLY = { id: "i784852", name: "Holly Kelly", status: "onboarding" }

// Wed 2026-11-18 09:00 Toronto
export const NOW = Date.parse("2026-11-18T14:00:00Z")

export function makeCtx(overrides = {}) {
  const nowMs = overrides.nowMs ?? NOW
  const sinceMs = overrides.sinceMs ?? nowMs - 24 * 3600_000
  return {
    athlete: JACKY,
    nowMs,
    sinceMs,
    sinceLocal: toLocal(sinceMs, TZ),
    darkLocal: toLocal(nowMs - 72 * 3600_000, TZ),
    today: toLocal(nowMs, TZ).slice(0, 10),
    horizonDays: 14,
    activities: [],
    events: [],
    threads: {},
    ...overrides,
  }
}

let nextId = 1000
export function act(o = {}) {
  return slimActivity({
    id: `i${nextId++}`,
    start_date_local: "2026-11-17T17:00:00",
    type: "Run",
    name: "Easy run",
    moving_time: 3000,
    icu_chat_id: null,
    source: "GARMIN_CONNECT",
    ...o,
  })
}

export function stub(o = {}) {
  return slimActivity({ id: String(nextId++), start_date_local: "2026-11-17T08:00:00", source: "STRAVA", ...o })
}

export function ev(o = {}) {
  const day = o.day ?? "2026-11-19"
  const { day: _d, ...rest } = o
  return slimEvent({
    id: nextId++,
    start_date_local: `${day}T00:00:00`,
    category: "WORKOUT",
    type: "Run",
    name: "Workout",
    description: "",
    moving_time: 3600,
    distance: 0,
    workout_doc: { duration: 3600 },
    created_by_id: COACH,
    updated: "2026-11-04T22:26:11.110+00:00",
    for_week: false,
    training_availability: "NORMAL",
    ...rest,
  })
}

export function msg(athlete_id, created, content) {
  return { athlete_id, created, content }
}

// One workout on every day from `from` for `n` days.
export function fullPlan(from, n) {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  for (let i = 0; i < n; i++) {
    out.push(ev({ day: d.toISOString().slice(0, 10) }))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
