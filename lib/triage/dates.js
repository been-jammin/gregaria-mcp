// Timezone-aware date helpers. All "local" strings are "YYYY-MM-DDTHH:mm:ss"
// in the athlete's timezone, so they compare lexicographically with the
// start_date_local values Intervals returns.

const fmtCache = new Map()
function formatter(timeZone) {
  if (!fmtCache.has(timeZone)) {
    fmtCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }))
  }
  return fmtCache.get(timeZone)
}

// Epoch ms -> local "YYYY-MM-DDTHH:mm:ss" in timeZone.
export function toLocal(ms, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

export function dayOf(localStr) {
  return localStr ? localStr.slice(0, 10) : null
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diffDays(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

// 0 = Monday ... 6 = Sunday
export function weekdayIndex(day) {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
export function weekdayName(day) {
  return WEEKDAYS[weekdayIndex(day)]
}
