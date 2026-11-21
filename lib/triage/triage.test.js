import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { priorityFor, runChecks, assembleItems } from "./assemble.js"
import { runTriage } from "./index.js"
import { createLimiter, withRetry, clearTimezoneCache } from "./fetch.js"
import { makeCtx, act, ev, msg, JACKY, HOLLY, COACH, NOW } from "./fixtures.js"

describe("priorityFor", () => {
  test("empty_day / tbd: 0-7 days out high, 8-14 medium", () => {
    assert.equal(priorityFor("empty_day", 7).priority, "high")
    assert.equal(priorityFor("empty_day", 8).priority, "medium")
    assert.equal(priorityFor("tbd", 0).rank, 4)
    assert.equal(priorityFor("tbd", 9).rank, 8)
  })
  test("empty_week ranks like empty_day", () => {
    assert.deepEqual(priorityFor("empty_week", 9), priorityFor("empty_day", 9))
  })
})

describe("runChecks", () => {
  test("onboarding athletes get only comment and note items", () => {
    const a = act({ icu_chat_id: 1 })
    const ctx = makeCtx({
      athlete: HOLLY,
      activities: [a],
      threads: { [a.id]: [msg(HOLLY.id, "2026-11-18T01:00:00Z", "Is this pace ok?")] },
      events: [],
    })
    assert.deepEqual(runChecks(ctx).map((i) => i.type), ["comment_question"])
  })

  test("include limits which checks run", () => {
    const items = runChecks(makeCtx({ events: [] }), new Set(["tbd"]))
    assert.equal(items.length, 0)
  })
})

describe("assembleItems", () => {
  test("one flat list sorted by tier, rank, date — not grouped by athlete", () => {
    const other = { id: "i1", name: "Other Athlete", status: "active" }
    const items = assembleItems([
      { athlete: JACKY, items: [
        { type: "comment_positive", date: "2026-11-17", summary: "p" },
        { type: "empty_day", date: "2026-11-20", days_out: 2, summary: "e" },
      ] },
      { athlete: other, items: [
        { type: "dark", date: "2026-11-12", summary: "d" },
        { type: "empty_day", date: "2026-11-19", days_out: 1, summary: "e" },
      ] },
    ])
    assert.deepEqual(items.map((i) => [i.priority, i.type, i.athlete_id]), [
      ["high", "empty_day", "i1"],
      ["high", "empty_day", JACKY.id],
      ["medium", "dark", "i1"],
      ["low", "comment_positive", JACKY.id],
    ])
    assert.deepEqual(Object.keys(items[0]), ["priority", "type", "athlete_id", "athlete_name", "date", "summary", "ref", "detail"])
  })

  test("min_priority drops lower tiers", () => {
    const items = assembleItems([{ athlete: JACKY, items: [
      { type: "comment_positive", summary: "p" },
      { type: "dark", summary: "d" },
    ] }], { minPriority: "medium" })
    assert.deepEqual(items.map((i) => i.type), ["dark"])
  })
})

describe("fetch helpers", () => {
  test("withRetry retries 429 with 1s/2s/4s backoff then gives up", async () => {
    const waits = []
    let calls = 0
    const err = Object.assign(new Error("429"), { status: 429 })
    await assert.rejects(withRetry(async () => { calls++; throw err }, { sleep: async (ms) => waits.push(ms) }))
    assert.equal(calls, 4)
    assert.deepEqual(waits, [1000, 2000, 4000])
  })

  test("withRetry does not retry other errors", async () => {
    let calls = 0
    await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("404"), { status: 404 }) }, { sleep: async () => {} }))
    assert.equal(calls, 1)
  })

  test("limiter never exceeds its cap", async () => {
    const limit = createLimiter(3)
    let active = 0, peak = 0
    await Promise.all(Array.from({ length: 12 }, () => limit(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })))
    assert.equal(peak, 3)
  })
})

describe("runTriage (stubbed API)", () => {
  beforeEach(() => clearTimezoneCache())

  function fakeApi() {
    const swim = { id: "i211440635", start_date_local: "2026-11-17T12:00:00", type: "Swim", name: "Pool", source: "GARMIN_CONNECT", icu_chat_id: 1 }
    const data = {
      [JACKY.id]: {
        tz: "America/Toronto",
        activities: [swim],
        events: [{ id: 1, start_date_local: "2026-11-19T00:00:00", category: "WORKOUT", type: "Run", name: "easy", moving_time: null, distance: 0, created_by_id: COACH }],
        messages: { [swim.id]: [{ athlete_id: JACKY.id, created: "2026-11-17T22:21:15Z", content: "Do you know Trevor?" }] },
      },
      [HOLLY.id]: {
        tz: "America/Edmonton",
        activities: [{ id: "20967463062", start_date_local: "2026-11-16T19:59:13", source: "STRAVA" },
          { id: "20967463063", start_date_local: "2026-11-15T19:59:13", source: "STRAVA" }],
        events: [],
        messages: {},
      },
    }
    const calls = { messages: 0 }
    return {
      calls,
      api: {
        getAthleteInfo: async (id) => {
          if (id === "i500") throw Object.assign(new Error("403 Forbidden"), { status: 403 })
          return { timezone: data[id].tz }
        },
        getActivities: async (id) => data[id].activities,
        getEvents: async (id) => data[id].events,
        getActivityMessages: async (aid) => {
          calls.messages++
          return Object.values(data).flatMap((d) => d.messages[aid] ?? [])
        },
      },
    }
  }

  test("end to end: sorted items, Holly only in skipped, failures isolated", async () => {
    const { api, calls } = fakeApi()
    // i500 has a profile error -> falls back to default tz, then fails on activities
    api.getActivities = ((orig) => async (id, ...rest) => {
      if (id === "i500") throw new Error("boom")
      return orig(id, ...rest)
    })(api.getActivities)

    const out = await runTriage(
      { athlete_ids: [JACKY.id, HOLLY.id, "i500"], since: "2026-11-17T16:00:00-05:00" },
      "key",
      { api, now: NOW },
    )

    assert.equal(out.window.horizon_days, 14)
    assert.ok(out.items.every((i) => i.athlete_id === JACKY.id), "Holly gets no items")
    const tiers = out.items.map((i) => ["high", "medium", "low"].indexOf(i.priority))
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b))
    assert.ok(out.items.some((i) => i.type === "comment_question" && i.ref.activity_id === "i211440635"))
    assert.ok(out.items.some((i) => i.type === "tbd" && i.priority === "high"))

    const holly = out.skipped.find((s) => s.athlete_id === HOLLY.id)
    assert.match(holly.reason, /2 Strava-only activities/)
    assert.match(out.skipped.find((s) => s.athlete_id === "i500").reason, /boom/)
    assert.equal(calls.messages, 1, "stubs and chat-less activities don't trigger message calls")
  })

  test("include filter is applied", async () => {
    const { api } = fakeApi()
    const out = await runTriage({ athlete_ids: [JACKY.id], include: ["tbd"] }, "key", { api, now: NOW })
    assert.ok(out.items.length > 0)
    assert.ok(out.items.every((i) => i.type === "tbd"))
  })
})
