import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { cleanDescription, zonePercents, slimActivity, slimEvent, buildAthleteCalendar } from "./events-slim.js"

const DREW = "i785965"
const COACH = "i782141"

describe("cleanDescription", () => {
  test("strips the tp2intervals tail", () => {
    const d = "Complete rest. walking and other recovery methods encouraged\n- - - -\nImported with tp2intervals (https://github.com/freekode/tp2intervals)\n\n//////////\ntrainingPeaksId=3943555943"
    assert.equal(cleanDescription(d), "Complete rest. walking and other recovery methods encouraged")
  })
  test("a description that is only the tail becomes undefined", () => {
    assert.equal(cleanDescription("\n- - - -\nImported with tp2intervals (x)\n\n//////////\ntrainingPeaksId=2560353"), undefined)
  })
  test("truncates long text", () => {
    const out = cleanDescription("a".repeat(500))
    assert.equal(out.length, 201)
    assert.ok(out.endsWith("…"))
  })
  test("null stays undefined", () => {
    assert.equal(cleanDescription(null), undefined)
  })
})

describe("zonePercents", () => {
  test("power zones as objects, sweet spot reported separately", () => {
    const z = zonePercents([
      { id: "Z1", secs: 472 }, { id: "Z2", secs: 1399 }, { id: "Z3", secs: 3750 },
      { id: "Z4", secs: 1169 }, { id: "Z5", secs: 356 }, { id: "Z6", secs: 94 },
      { id: "Z7", secs: 16 }, { id: "SS", secs: 1596 },
    ])
    assert.deepEqual(z, { pct: [7, 19, 52, 16, 5, 1], ss: 22 })
  })
  test("HR zones as plain seconds, trailing zeros trimmed", () => {
    assert.deepEqual(zonePercents([4061, 3195, 0, 0, 0, 0, 0]), { pct: [56, 44] })
  })
  test("no data", () => {
    assert.equal(zonePercents(null), undefined)
    assert.equal(zonePercents([0, 0, 0]), undefined)
  })
})

const RIDE = {
  id: "i213387509", start_date_local: "2026-11-22T12:19:22", type: "VirtualRide",
  name: "Zwift - Flat Out Fast in Watopia", moving_time: 7256, distance: 62828.01,
  icu_training_load: 141, compliance: 100.77778, icu_rpe: 5, feel: 3,
  average_heartrate: 134, icu_average_watts: 160, paired_event_id: 154832033,
  icu_zone_times: [{ id: "Z1", secs: 472 }, { id: "Z2", secs: 1399 }, { id: "SS", secs: 0 }],
  icu_hr_zone_times: [4061, 3195, 0], pace_zone_times: null, icu_chat_id: 2482102,
  source: "ZWIFT", skyline_chart_bytes: "xyz", icu_hr_zones: [136, 152],
}

describe("slimActivity", () => {
  test("keeps compliance, RPE, feel and zones; drops everything else", () => {
    assert.deepEqual(slimActivity(RIDE), {
      aid: "i213387509", date: "2026-11-22", sport: "VirtualRide", name: "Zwift - Flat Out Fast in Watopia",
      min: 121, m: 62828, load: 141, comp: 101, rpe: 5, feel: 3, avg_hr: 134, avg_w: 160,
      pwr_z: { pct: [25, 75] }, hr_z: { pct: [56, 44] }, chat: true,
    })
  })
  test("Strava stub is flagged, not summarized", () => {
    assert.deepEqual(slimActivity({ id: 5, source: "STRAVA", start_date_local: "2026-11-21T07:00:00" }),
      { aid: "5", stub: true, date: "2026-11-21" })
  })
  test("pace zones use GAP when the activity says so", () => {
    const s = slimActivity({ id: 1, pace_zone_times: [10, 0], gap_zone_times: [0, 10], use_gap_zone_times: true })
    assert.deepEqual(s.pace_z, { pct: [0, 100] })
  })
})

describe("slimEvent", () => {
  test("planned ride", () => {
    assert.deepEqual(slimEvent({
      id: 154832035, start_date_local: "2026-11-28T00:00:00", category: "WORKOUT", type: "Ride",
      name: "endurance bike", description: "free ride, Z2", moving_time: 7500, created_by_id: COACH,
      training_availability: "NORMAL", for_week: false, workout_doc: { steps: [], duration: 7500 },
    }, DREW), {
      id: 154832035, date: "2026-11-28", cat: "WORKOUT", sport: "Ride", name: "endurance bike", min: 125, desc: "free ride, Z2",
    })
  })
  test("falls back to workout_doc distance and flags athlete-created events", () => {
    const s = slimEvent({ id: 1, start_date_local: "2026-11-27T00:00:00", category: "NOTE", created_by_id: DREW,
      workout_doc: { duration: 2700, distance: 1250 } }, DREW)
    assert.equal(s.m, 1250)
    assert.equal(s.min, 45)
    assert.equal(s.by, "athlete")
  })
  test("holiday availability and week notes surface", () => {
    const s = slimEvent({ id: 2, start_date_local: "2026-11-23T00:00:00", category: "HOLIDAY",
      training_availability: "UNAVAILABLE", for_week: true }, DREW)
    assert.equal(s.avail, "UNAVAILABLE")
    assert.equal(s.for_week, true)
  })
})

describe("buildAthleteCalendar", () => {
  const events = [
    { id: 154832033, start_date_local: "2026-11-22T00:00:00", category: "WORKOUT", type: "Ride", name: "endurance bike", moving_time: 7200 },
    { id: 9, start_date_local: "2026-11-21T00:00:00", category: "NOTE", name: "Rest Day" },
  ]
  const unplannedRun = { id: "i1", start_date_local: "2026-11-21T08:00:00", type: "Run", moving_time: 1800, compliance: null }

  test("pairs completed activity onto its event and lists the rest as unplanned", () => {
    const cal = buildAthleteCalendar(DREW, events, [RIDE, unplannedRun])
    assert.equal(cal.events[0].date, "2026-11-21")
    assert.equal(cal.events[1].done.aid, "i213387509")
    assert.equal(cal.events[1].done.comp, 101)
    assert.equal(cal.unplanned.length, 1)
    assert.equal(cal.unplanned[0].aid, "i1")
  })
  test("category filter still keeps paired activities out of unplanned", () => {
    const cal = buildAthleteCalendar(DREW, events, [RIDE], { categories: ["NOTE"] })
    assert.equal(cal.events.length, 1)
    assert.equal(cal.unplanned, undefined)
  })
  test("activity paired to an event outside the window shows as unplanned", () => {
    const cal = buildAthleteCalendar(DREW, [], [RIDE])
    assert.equal(cal.unplanned[0].aid, "i213387509")
  })
})
