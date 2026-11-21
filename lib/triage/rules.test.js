import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  classifyComment,
  checkComments,
  checkAthleteNotes,
  checkEmptyDays,
  checkTbd,
  checkSuspiciousDuration,
  checkDark,
  checkSilent,
  checkNewPr,
} from "./rules.js"
import { makeCtx, act, stub, ev, msg, fullPlan, JACKY, COACH, NOW } from "./fixtures.js"

const JACKY_SWIM_TEXT = "So I started with a warm up and some drills (catch up, fist drill) and was going to do more, but ended up getting an unsolicited coaching session. Do you know someone named Trevor? Anyway, I guess like I thought, my catch is off..."

describe("classifyComment", () => {
  test("negative beats question", () => {
    assert.equal(classifyComment("My knee is sore, should I skip tomorrow?"), "comment_negative")
  })
  test("question mark makes it a question", () => {
    assert.equal(classifyComment("Do you know someone named Trevor?"), "comment_question")
  })
  test("anything else is positive", () => {
    assert.equal(classifyComment("Felt great today"), "comment_positive")
  })
  test("curly-apostrophe couldn’t counts as negative", () => {
    assert.equal(classifyComment("I couldn’t finish the last rep"), "comment_negative")
  })
})

describe("checkComments", () => {
  const swim = act({ id: "i211440635", type: "Swim", name: "Pool swim", start_date_local: "2026-11-17T12:00:00", icu_chat_id: 1 })

  test("Jacky's swim comment is a comment_question when since is before 2026-11-17 17:00", () => {
    const ctx = makeCtx({
      sinceMs: Date.parse("2026-11-17T16:00:00-05:00"),
      activities: [swim],
      threads: { [swim.id]: [msg(JACKY.id, "2026-11-17T22:21:15.140+00:00", JACKY_SWIM_TEXT)] },
    })
    const items = checkComments(ctx)
    assert.equal(items.length, 1)
    assert.equal(items[0].type, "comment_question")
    assert.deepEqual(items[0].ref, { activity_id: "i211440635" })
    assert.equal(items[0].date, "2026-11-17")
    assert.ok(items[0].summary.length <= 120)
  })

  test("comment older than since is not new", () => {
    const ctx = makeCtx({
      sinceMs: Date.parse("2026-11-17T18:00:00-05:00"),
      activities: [swim],
      threads: { [swim.id]: [msg(JACKY.id, "2026-11-17T22:21:15.140+00:00", JACKY_SWIM_TEXT)] },
    })
    assert.equal(checkComments(ctx).length, 0)
  })

  test("comments the coach already replied to don't appear (Jacky's strength session)", () => {
    const strength = act({ type: "WeightTraining", start_date_local: "2026-11-17T20:23:00", icu_chat_id: 2 })
    const ctx = makeCtx({
      activities: [strength],
      threads: {
        [strength.id]: [
          msg(JACKY.id, "2026-11-18T02:30:00Z", "Was that too much weight?"),
          msg(COACH, "2026-11-18T03:00:00Z", "Looks right to me"),
        ],
      },
    })
    assert.equal(checkComments(ctx).length, 0)
  })

  test("trailing athlete messages are combined; third-party messages ignored", () => {
    const a = act({ icu_chat_id: 3 })
    const ctx = makeCtx({
      activities: [a],
      threads: {
        [a.id]: [
          msg(COACH, "2026-11-17T20:00:00Z", "Nice"),
          msg(JACKY.id, "2026-11-17T21:00:00Z", "Thanks!"),
          msg(JACKY.id, "2026-11-17T21:05:00Z", "Legs were sore though"),
          msg("i999", "2026-11-17T22:00:00Z", "Go Jacky!"),
        ],
      },
    })
    const [item] = checkComments(ctx)
    assert.equal(item.type, "comment_negative")
    assert.equal(item.detail.messages, 2)
    assert.match(item.detail.comment, /Thanks!\nLegs were sore/)
  })

  test("comment text is truncated to 300 chars with a flag", () => {
    const a = act({ icu_chat_id: 4 })
    const ctx = makeCtx({ activities: [a], threads: { [a.id]: [msg(JACKY.id, "2026-11-18T01:00:00Z", "x".repeat(500))] } })
    const [item] = checkComments(ctx)
    assert.equal(item.detail.comment.length, 300)
    assert.equal(item.detail.truncated, true)
  })
})

describe("checkAthleteNotes", () => {
  test("note created by the athlete since `since` is reported; coach notes and old notes aren't", () => {
    const mine = ev({ category: "NOTE", name: "Travelling Friday", created_by_id: JACKY.id, updated: "2026-11-18T01:00:00Z", day: "2026-11-21" })
    const old = ev({ category: "NOTE", name: "Old", created_by_id: JACKY.id, updated: "2026-11-10T01:00:00Z" })
    const coach = ev({ category: "NOTE", name: "Coach note", updated: "2026-11-18T01:00:00Z" })
    const items = checkAthleteNotes(makeCtx({ events: [mine, old, coach] }))
    assert.equal(items.length, 1)
    assert.deepEqual(items[0].ref, { event_id: mine.id })
    assert.equal(items[0].date, "2026-11-21")
  })

  test("athlete-created holiday counts as a note", () => {
    const hol = ev({ category: "HOLIDAY", name: "Work trip", created_by_id: JACKY.id, updated: "2026-11-18T01:00:00Z" })
    assert.equal(checkAthleteNotes(makeCtx({ events: [hol] }))[0].detail.category, "HOLIDAY")
  })
})

describe("checkEmptyDays", () => {
  // today = Wed 2026-11-18, horizon 14 -> 2026-11-18 .. 2026-12-02
  const planAllBut = (skip) => fullPlan("2026-11-18", 15).filter((e) => !skip.includes(e.start_date_local.slice(0, 10)))

  test("an empty day is reported with days_out", () => {
    const items = checkEmptyDays(makeCtx({ events: planAllBut(["2026-11-20"]) }))
    assert.equal(items.length, 1)
    assert.equal(items[0].type, "empty_day")
    assert.equal(items[0].date, "2026-11-20")
    assert.equal(items[0].days_out, 2)
  })

  test("a NOTE titled 'Rest Day' (any case, trimmed) fills the day", () => {
    const events = [...planAllBut(["2026-11-20", "2026-11-21"]),
      ev({ day: "2026-11-20", category: "NOTE", name: "  Rest Day " }),
      ev({ day: "2026-11-21", category: "NOTE", name: "rest" })]
    assert.equal(checkEmptyDays(makeCtx({ events })).length, 0)
  })

  test("a note with another title does not fill the day", () => {
    const events = [...planAllBut(["2026-11-20"]), ev({ day: "2026-11-20", category: "NOTE", name: "Rest up for Saturday" })]
    assert.equal(checkEmptyDays(makeCtx({ events })).length, 1)
  })

  test("for_week events don't fill a single day", () => {
    const events = [...planAllBut(["2026-11-23"]),
      ev({ day: "2026-11-23", category: "NOTE", name: "rest", for_week: true }),
      ev({ day: "2026-11-23", for_week: true })]
    assert.deepEqual(checkEmptyDays(makeCtx({ events })).map((i) => i.date), ["2026-11-23"])
  })

  test("UNAVAILABLE holiday fills its whole range; LIMITED doesn't", () => {
    const events = [...planAllBut(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-28"]),
      ev({ day: "2026-11-24", category: "HOLIDAY", name: "Work trip", training_availability: "UNAVAILABLE", end_date_local: "2026-11-27T00:00:00" }),
      ev({ day: "2026-11-28", category: "HOLIDAY", name: "Family", training_availability: "LIMITED", end_date_local: "2026-11-29T00:00:00" })]
    assert.deepEqual(checkEmptyDays(makeCtx({ events })).map((i) => i.date), ["2026-11-28"])
  })

  test("nothing planned at all -> ONE empty_week item, not one per day", () => {
    const items = checkEmptyDays(makeCtx({ events: [] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].type, "empty_week")
    assert.equal(items[0].days_out, 0)
    assert.equal(items[0].detail.empty_days, 15)
  })

  test("a fully empty Mon-Sun week collapses into one empty_week item", () => {
    const week = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]
    const items = checkEmptyDays(makeCtx({ events: planAllBut(week) }))
    assert.equal(items.length, 1)
    assert.equal(items[0].type, "empty_week")
    assert.equal(items[0].date, "2026-11-23")
    assert.equal(items[0].summary, "Nothing planned 2026-11-23 to 2026-11-29")
  })

  test("an activity done today fills today", () => {
    const events = planAllBut(["2026-11-18"])
    const activities = [act({ start_date_local: "2026-11-18T07:00:00" })]
    assert.equal(checkEmptyDays(makeCtx({ events, activities })).length, 0)
  })
})

describe("checkTbd", () => {
  const noVolume = { moving_time: null, distance: 0, workout_doc: { duration: 0 } }

  test("swim described as '1200m total' is not TBD; a run with no duration or distance is", () => {
    const swim = ev({ type: "Swim", name: "Swim", description: "1200m total, easy", ...noVolume })
    const run = ev({ type: "Run", name: "easy run", ...noVolume })
    const items = checkTbd(makeCtx({ events: [swim, run] }))
    assert.deepEqual(items.map((i) => i.ref.event_id), [run.id])
  })

  test("'1200 meters' and '4x100m' also count as meters for swims", () => {
    const a = ev({ type: "Swim", description: "1200 meters steady", ...noVolume })
    const b = ev({ type: "Swim", description: "warmup then 4x100m", ...noVolume })
    assert.equal(checkTbd(makeCtx({ events: [a, b] })).length, 0)
  })

  test("swim with no meters and no volume is TBD (Genevieve's group swim)", () => {
    const s = ev({ type: "Swim", name: "group swim 1", description: "have fun and good luck!", ...noVolume })
    assert.equal(checkTbd(makeCtx({ events: [s] })).length, 1)
  })

  test("#TBD in the description is TBD even with a duration", () => {
    const e = ev({ description: "long run #TBD" })
    assert.equal(checkTbd(makeCtx({ events: [e] }))[0].detail.reason, "#TBD in description")
  })

  test("coach-created Other workouts with no duration (notes saved as workouts) are not TBD", () => {
    const note = ev({ type: "Other", name: "Load going up this week", ...noVolume })
    assert.equal(checkTbd(makeCtx({ events: [note] })).length, 0)
  })

  test("placeholder next to a built workout of the same sport gets possible_duplicate", () => {
    const placeholder = ev({ type: "Ride", name: "threshold bike", day: "2026-11-24", ...noVolume })
    const built = ev({ type: "Ride", name: "4x6 min @ threshold", day: "2026-11-24", moving_time: 3900 })
    const [item] = checkTbd(makeCtx({ events: [placeholder, built] }))
    assert.equal(item.detail.possible_duplicate, true)
  })

  test("days_out is set for tiering and past/for_week workouts are ignored", () => {
    const past = ev({ day: "2026-11-15", ...noVolume })
    const weekly = ev({ day: "2026-11-23", for_week: true, ...noVolume })
    const later = ev({ day: "2026-11-28", ...noVolume })
    const items = checkTbd(makeCtx({ events: [past, weekly, later] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].days_out, 10)
  })
})

describe("checkSuspiciousDuration", () => {
  test("7.5 h swim is flagged; a 5 h ride is not", () => {
    const swim = ev({ type: "Swim", moving_time: 27000, workout_doc: { duration: 27000 } })
    const ride = ev({ type: "Ride", moving_time: 18000 })
    const items = checkSuspiciousDuration(makeCtx({ events: [swim, ride] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].detail.planned_hours, 7.5)
  })
})

describe("checkDark", () => {
  test("no activities, notes or messages in 72 h -> dark", () => {
    const items = checkDark(makeCtx({ activities: [act({ start_date_local: "2026-11-13T07:00:00" })] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].detail.days_dark, 5)
  })

  test("a Strava stub proves training, so not dark", () => {
    assert.equal(checkDark(makeCtx({ activities: [stub({ start_date_local: "2026-11-17T08:00:00" })] })).length, 0)
  })

  test("an athlete-created note in the last 72 h means not dark", () => {
    const note = ev({ category: "NOTE", created_by_id: JACKY.id, updated: new Date(NOW - 3600_000).toISOString() })
    assert.equal(checkDark(makeCtx({ events: [note] })).length, 0)
  })

  test("coach messages don't count as athlete correspondence", () => {
    const a = act({ start_date_local: "2026-11-10T07:00:00", icu_chat_id: 9 })
    const ctx = makeCtx({ activities: [a], threads: { [a.id]: [msg(COACH, new Date(NOW - 3600_000).toISOString(), "How's it going?")] } })
    assert.equal(checkDark(ctx).length, 1)
  })
})

describe("checkSilent", () => {
  const four = () => [1, 2, 3, 4].map((i) => act({ start_date_local: `2026-11-1${i}T07:00:00`, icu_chat_id: i }))
    .reverse()

  test("no athlete comments on last 4 activities -> silent", () => {
    const activities = four()
    const threads = { [activities[0].id]: [msg(COACH, "2026-11-14T10:00:00Z", "Great job")] }
    assert.equal(checkSilent(makeCtx({ activities, threads })).length, 1)
  })

  test("one athlete comment in the last 4 -> not silent", () => {
    const activities = four()
    const threads = { [activities[2].id]: [msg(JACKY.id, "2026-11-12T10:00:00Z", "ok")] }
    assert.equal(checkSilent(makeCtx({ activities, threads })).length, 0)
  })

  test("fewer than 4 readable activities -> no judgement", () => {
    assert.equal(checkSilent(makeCtx({ activities: four().slice(0, 3) })).length, 0)
  })
})

describe("checkNewPr (assumed achievement shape)", () => {
  test("bike 20 min power best since `since` is reported; 5 min is not", () => {
    const a = act({ type: "Ride", start_date_local: "2026-11-18T07:00:00", icu_achievements: [
      { type: "BEST_POWER", secs: 1200, value: 250 },
      { type: "BEST_POWER", secs: 300, value: 300 },
    ] })
    const [item] = checkNewPr(makeCtx({ activities: [a] }))
    assert.equal(item.detail.bests.length, 1)
    assert.equal(item.detail.bests[0].secs, 1200)
  })

  test("swim only counts 20 min pace", () => {
    const a = act({ type: "Swim", start_date_local: "2026-11-18T07:00:00", icu_achievements: [{ type: "BEST_HR", secs: 1200 }] })
    assert.equal(checkNewPr(makeCtx({ activities: [a] })).length, 0)
  })
})
