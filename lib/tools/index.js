import { registerAthleteTools } from "./athlete.js"
import { registerWellnessTools } from "./wellness.js"
import { registerActivityTools } from "./activities.js"
import { registerEventTools } from "./events.js"
import { registerAnalysisTools } from "./analysis.js"

// Tools listed in DISABLED_TOOLS (comma-separated) are not registered at all.
// In owner mode (MCP_ACCESS_SECRET set) the three delete tools are off by
// default; set DISABLED_TOOLS explicitly (even to a single space-free dummy
// name) to override.
const OWNER_DEFAULT_DISABLED = "delete_activity,delete_event,delete_events_by_date_range"

export function registerTools(server) {
  const raw = process.env.DISABLED_TOOLS ?? (process.env.MCP_ACCESS_SECRET ? OWNER_DEFAULT_DISABLED : "")
  const disabled = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))
  if (disabled.size) {
    const original = server.tool.bind(server)
    server.tool = (name, ...rest) => (disabled.has(name) ? undefined : original(name, ...rest))
  }
  registerAthleteTools(server)
  registerWellnessTools(server)
  registerActivityTools(server)
  registerEventTools(server)
  registerAnalysisTools(server)
}
