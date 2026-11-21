// Live smoke test for coaching_triage against the real Intervals.icu API.
// Usage (PowerShell):
//   $env:INTERVALS_API_KEY = "<coach personal API key>"; node scripts/triage-live.mjs [since-iso]
// Prints timing, response size and item counts; writes the full response to
// scripts/triage-live-output.json (git-ignored).
import { writeFileSync } from "node:fs"
import { runTriage } from "../lib/triage/index.js"
import { API_KEY_PREFIX } from "../lib/intervals/client.js"

const key = process.env.INTERVALS_API_KEY
if (!key) {
  console.error("Set INTERVALS_API_KEY first.")
  process.exit(1)
}

const args = process.argv[2] ? { since: process.argv[2] } : {}
const t0 = Date.now()
const out = await runTriage(args, API_KEY_PREFIX + key)
const secs = (Date.now() - t0) / 1000
const json = JSON.stringify(out)

const counts = {}
for (const i of out.items) counts[`${i.priority} ${i.type}`] = (counts[`${i.priority} ${i.type}`] ?? 0) + 1

console.log(`time: ${secs.toFixed(1)} s (target < 15 s, must be < 30 s)`)
console.log(`size: ${(json.length / 1024).toFixed(1)} KB (target < 15 KB)`)
console.log(`items: ${out.items.length}`)
console.table(counts)
console.log("skipped:", out.skipped)
writeFileSync(new URL("./triage-live-output.json", import.meta.url), JSON.stringify(out, null, 2))
console.log("full output: scripts/triage-live-output.json")
