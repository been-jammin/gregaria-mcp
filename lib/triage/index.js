// coaching_triage orchestrator: resolve roster and window, fetch each athlete
// in parallel (shared concurrency cap), run rules, assemble one sorted list.
// One athlete failing becomes a `skipped` entry, never a failed call.
import {
  getAthleteInfo,
  getActivities,
  getEvents,
  getActivityMessages,
} from "../intervals/index.js"
import { ROSTER, MAX_IN_FLIGHT } from "./config.js"
import { createLimiter, withRetry, fetchAthleteData } from "./fetch.js"
import { runChecks, assembleItems } from "./assemble.js"

const DEFAULT_API = { getAthleteInfo, getActivities, getEvents, getActivityMessages }

export function resolveRoster(athleteIds) {
  if (!athleteIds?.length) return ROSTER
  return athleteIds.map((id) => ROSTER.find((a) => a.id === id) ?? { id, name: id, status: "active" })
}

export async function runTriage(args = {}, apiKey, { api = DEFAULT_API, now = Date.now(), sleep } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now)
  const sinceMs = args.since ? Date.parse(args.since) : nowMs - 24 * 3600_000
  if (Number.isNaN(sinceMs)) throw new Error(`Invalid 'since': ${args.since}`)
  const horizonDays = args.horizon_days ?? 14
  const include = args.include?.length ? new Set(args.include) : null

  const limit = createLimiter(MAX_IN_FLIGHT)
  const call = (fn) => limit(() => withRetry(fn, sleep ? { sleep } : undefined))

  const roster = resolveRoster(args.athlete_ids)
  const results = []
  const skipped = []

  await Promise.all(roster.map(async (athlete) => {
    try {
      const data = await fetchAthleteData(athlete, { apiKey, api, call, nowMs, sinceMs, horizonDays })
      const ctx = { athlete, nowMs, sinceMs, horizonDays, ...data }
      results.push({ athlete, items: runChecks(ctx, include) })
      const stubs = data.activities.filter((a) => a.is_stub).length
      if (stubs) {
        skipped.push({
          athlete_id: athlete.id,
          athlete_name: athlete.name,
          reason: `${stubs} Strava-only ${stubs === 1 ? "activity" : "activities"}, not readable via API`,
        })
      }
    } catch (e) {
      skipped.push({ athlete_id: athlete.id, athlete_name: athlete.name, reason: `Error: ${e.message}` })
    }
  }))

  skipped.sort((a, b) => a.athlete_name.localeCompare(b.athlete_name))
  return {
    generated_at: new Date(nowMs).toISOString(),
    window: { since: new Date(sinceMs).toISOString(), horizon_days: horizonDays },
    items: assembleItems(results, { minPriority: args.min_priority ?? "low" }),
    skipped,
  }
}
