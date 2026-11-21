// Configuration for the coaching_triage tool: roster, coach identity, and the
// priority table. Edit here to re-tier items; no logic lives in this file.

// The coach's own Intervals.icu athlete id. Messages from this id never count
// as athlete correspondence.
export const COACH_ID = "i782141"

// Active Roster. Display names come from here, not from profiles ("Danderson"
// is Drew Anderson). status: "active" | "onboarding". Onboarding athletes only
// get comment and athlete-note items (no plan, so no empty/tbd/dark/silent).
export const ROSTER = [
  { id: "i783747", name: "Abdalrhman Abuassamen", status: "active" },
  { id: "i785965", name: "Drew Anderson", status: "active" },
  { id: "i792770", name: "Don Devenny", status: "active" },
  { id: "i783812", name: "Genevieve Courchesne", status: "active" },
  { id: "i784852", name: "Holly Kelly", status: "onboarding" },
  { id: "i799428", name: "Jacky Janelle", status: "active" },
  { id: "i793313", name: "Jenny O", status: "active" },
  { id: "i789215", name: "Robert Shotton", status: "active" },
  { id: "i783609", name: "Trevor Rivington", status: "active" },
  { id: "i798088", name: "Chris Fernandes", status: "active" },
]

export const PRIORITIES = ["high", "medium", "low"]

// Priority table: first matching row wins. A row with maxDaysOut only matches
// items whose day is at most that many days from today. empty_week items are
// ranked like empty_day (see RANK_ALIAS).
export const PRIORITY_RULES = [
  { type: "comment_negative", priority: "high", rank: 1 },
  { type: "athlete_note", priority: "high", rank: 2 },
  { type: "empty_day", maxDaysOut: 7, priority: "high", rank: 3 },
  { type: "tbd", maxDaysOut: 7, priority: "high", rank: 4 },
  { type: "dark", priority: "medium", rank: 5 },
  { type: "comment_question", priority: "medium", rank: 6 },
  { type: "empty_day", priority: "medium", rank: 7 },
  { type: "tbd", priority: "medium", rank: 8 },
  { type: "silent", priority: "low", rank: 9 },
  { type: "comment_positive", priority: "low", rank: 10 },
  { type: "new_pr", priority: "low", rank: 11 },
  { type: "suspicious_duration", priority: "low", rank: 12 },
]

export const RANK_ALIAS = { empty_week: "empty_day" }

export const ITEM_TYPES = [
  "comment_negative",
  "comment_question",
  "comment_positive",
  "athlete_note",
  "empty_day",
  "empty_week",
  "tbd",
  "dark",
  "silent",
  "new_pr",
  "suspicious_duration",
]

// Item types an onboarding athlete can produce.
export const ONBOARDING_TYPES = new Set([
  "comment_negative",
  "comment_question",
  "comment_positive",
  "athlete_note",
])

export const NEGATIVE_PATTERN =
  /\b(pain\w*|sore\w*|hurt\w*|injur\w*|sick\w*|exhausted|struggl\w*|couldn['’]?t|missed|bad)\b/i

export const COMMENT_MAX_CHARS = 300
export const DARK_HOURS = 72
export const SILENT_ACTIVITY_COUNT = 4
export const SUSPICIOUS_PLANNED_SECS = 4 * 3600
export const ACTIVITY_LOOKBACK_DAYS = 14
export const EVENT_LOOKBACK_DAYS = 7
export const MAX_IN_FLIGHT = 5

export const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "TrackRide", "Cyclocross", "EBikeRide", "EMountainBikeRide"])
export const RUN_TYPES = new Set(["Run", "VirtualRun", "TrailRun"])
export const SWIM_TYPES = new Set(["Swim", "OpenWaterSwim"])
