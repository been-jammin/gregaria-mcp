// Mappers that cut raw Intervals objects down to the fields the rules use.
// Anything not listed here is dropped before any logic runs. A few flags are
// computed from the full description first (it's truncated to 200 chars after).

const DESC_MAX = 200

export function slimActivity(a) {
  return {
    id: String(a.id),
    start_date_local: a.start_date_local ?? null,
    type: a.type ?? null,
    name: a.name ?? null,
    moving_time: a.moving_time ?? null,
    distance: a.distance ?? null,
    average_heartrate: a.average_heartrate ?? null,
    icu_rpe: a.icu_rpe ?? null,
    feel: a.feel ?? null,
    icu_chat_id: a.icu_chat_id ?? null,
    paired_event_id: a.paired_event_id ?? null,
    source: a.source ?? null,
    icu_achievements: Array.isArray(a.icu_achievements) && a.icu_achievements.length ? a.icu_achievements : null,
    is_stub: a.source === "STRAVA",
  }
}

const METERS_PATTERN = /\d+(?:[.,]\d+)?\s*(?:k?m|meters?|metres?|yds?|yards?)\b/i

export function slimEvent(e) {
  const fullDesc = e.description ?? ""
  return {
    id: e.id,
    start_date_local: e.start_date_local ?? null,
    end_date_local: e.end_date_local ?? null,
    category: e.category ?? null,
    type: e.type ?? null,
    name: e.name ?? null,
    description: fullDesc.slice(0, DESC_MAX),
    moving_time: e.moving_time ?? null,
    distance: e.distance ?? null,
    workout_doc_duration: e.workout_doc?.duration ?? null,
    created_by_id: e.created_by_id ?? null,
    updated: e.updated ?? null,
    for_week: Boolean(e.for_week),
    training_availability: e.training_availability ?? null,
    has_tbd_tag: /#TBD\b/i.test(fullDesc),
    mentions_meters: METERS_PATTERN.test(`${e.name ?? ""}\n${fullDesc}`),
  }
}

export function slimMessage(m) {
  return {
    athlete_id: m.athlete_id ?? null,
    created: m.created ?? null,
    content: m.content ?? "",
  }
}
