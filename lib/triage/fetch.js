// Thin fetch layer: concurrency cap, 429 retry with backoff, per-athlete data
// load. Everything returned is already slimmed.
import { slimActivity, slimEvent, slimMessage } from "./slim.js"
import { toLocal, addDays } from "./dates.js"
import { ACTIVITY_LOOKBACK_DAYS, EVENT_LOOKBACK_DAYS, SILENT_ACTIVITY_COUNT, DARK_HOURS } from "./config.js"

export const DEFAULT_TIMEZONE = "America/Toronto"

// Caps how many promises run at once; shared by every call in one triage pass.
export function createLimiter(max) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= max || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next() })
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next() })
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retries only on HTTP 429: waits 1 s, 2 s, 4 s between tries.
export async function withRetry(fn, { delays = [1000, 2000, 4000], sleep = defaultSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (e?.status !== 429 || attempt >= delays.length) throw e
      await sleep(delays[attempt])
    }
  }
}

// Profile timezones rarely change: cached for the life of the server instance.
const tzCache = new Map()
export function clearTimezoneCache() { tzCache.clear() }

async function getTimezone(athleteId, apiKey, api, call) {
  if (tzCache.has(athleteId)) return tzCache.get(athleteId)
  let tz = DEFAULT_TIMEZONE
  try {
    const profile = await call(() => api.getAthleteInfo(athleteId, apiKey))
    if (profile?.timezone) tz = profile.timezone
  } catch {
    return tz // don't cache a fallback; try again next pass
  }
  tzCache.set(athleteId, tz)
  return tz
}

// Loads one athlete's activities (last 14 days), events (7 days back to
// today + horizon) and, conditionally, activity chats: only activities with a
// chat that started after `since` or are among the last 4 readable ones.
export async function fetchAthleteData(athlete, { apiKey, api, call, nowMs, sinceMs, horizonDays }) {
  const timeZone = await getTimezone(athlete.id, apiKey, api, call)
  const nowLocal = toLocal(nowMs, timeZone)
  const today = nowLocal.slice(0, 10)
  const sinceLocal = toLocal(sinceMs, timeZone)
  const darkLocal = toLocal(nowMs - DARK_HOURS * 3600_000, timeZone)

  const [rawActivities, rawEvents] = await Promise.all([
    call(() => api.getActivities(athlete.id, apiKey, {
      start: addDays(today, -ACTIVITY_LOOKBACK_DAYS),
      end: `${today}T23:59:59`,
    })),
    call(() => api.getEvents(athlete.id, apiKey, {
      start: addDays(today, -EVENT_LOOKBACK_DAYS),
      end: `${addDays(today, horizonDays)}T23:59:59`,
    })),
  ])

  const activities = (Array.isArray(rawActivities) ? rawActivities : [])
    .map(slimActivity)
    .sort((a, b) => String(b.start_date_local).localeCompare(String(a.start_date_local)))
  const events = (Array.isArray(rawEvents) ? rawEvents : []).map(slimEvent)

  const lastReadable = new Set(activities.filter((a) => !a.is_stub).slice(0, SILENT_ACTIVITY_COUNT).map((a) => a.id))
  const toFetch = activities.filter((a) =>
    !a.is_stub && a.icu_chat_id != null &&
    (lastReadable.has(a.id) || (a.start_date_local && a.start_date_local >= sinceLocal)))

  const threads = {}
  await Promise.all(toFetch.map(async (a) => {
    const msgs = await call(() => api.getActivityMessages(a.id, apiKey))
    threads[a.id] = (Array.isArray(msgs) ? msgs : []).map(slimMessage)
  }))

  return { timeZone, today, sinceLocal, darkLocal, activities, events, threads }
}
