// Runs the rule functions for one athlete, then merges everyone's items into
// one flat list sorted by tier, rank, date.
import { PRIORITY_RULES, PRIORITIES, RANK_ALIAS, ONBOARDING_TYPES } from "./config.js"
import { CHECKS } from "./rules.js"

export function priorityFor(type, daysOut) {
  const key = RANK_ALIAS[type] ?? type
  const rule = PRIORITY_RULES.find((r) =>
    r.type === key && (r.maxDaysOut === undefined || (daysOut ?? 0) <= r.maxDaysOut))
  if (!rule) throw new Error(`No priority rule for item type '${type}'`)
  return rule
}

// include: Set of item types to keep (null = all).
export function runChecks(ctx, include = null) {
  const allowed = (t) =>
    (!include || include.has(t)) &&
    (ctx.athlete.status !== "onboarding" || ONBOARDING_TYPES.has(t))
  const items = []
  for (const check of CHECKS) {
    if (!check.types.some(allowed)) continue
    for (const item of check.fn(ctx)) {
      if (allowed(item.type)) items.push(item)
    }
  }
  return items
}

// results: [{ athlete, items }] with raw rule items.
export function assembleItems(results, { minPriority = "low" } = {}) {
  const maxTier = PRIORITIES.indexOf(minPriority)
  const out = []
  for (const { athlete, items } of results) {
    for (const it of items) {
      const rule = priorityFor(it.type, it.days_out)
      const tier = PRIORITIES.indexOf(rule.priority)
      if (tier > maxTier) continue
      out.push({
        _tier: tier,
        _rank: rule.rank,
        priority: rule.priority,
        type: it.type,
        athlete_id: athlete.id,
        athlete_name: athlete.name,
        date: it.date ?? null,
        summary: it.summary,
        ref: it.ref ?? null,
        detail: it.detail ?? null,
      })
    }
  }
  out.sort((a, b) =>
    a._tier - b._tier ||
    a._rank - b._rank ||
    // soonest first; undated items last within their rank
    (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
    a.athlete_name.localeCompare(b.athlete_name))
  return out.map(({ _tier, _rank, ...item }) => item)
}
