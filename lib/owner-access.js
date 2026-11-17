// Owner mode: a single-user deployment that uses ONE Intervals.icu API key kept
// in a server-side environment variable, protected by a long random secret in
// the connector URL (https://<domain>/api/mcp?k=<secret>).
//
// Enabled only when BOTH env vars are set:
//   MCP_ACCESS_SECRET  - random string, at least 32 chars (openssl rand -hex 32)
//   INTERVALS_API_KEY  - your personal Intervals.icu API key (coach login)
//
// When enabled, the deployment is owner-only: requests without the right
// secret are rejected (401), and the OAuth / Bearer paths are not used.
import { timingSafeEqual } from "node:crypto"

export const MIN_SECRET_LENGTH = 32

export function ownerModeEnabled() {
  return Boolean(process.env.MCP_ACCESS_SECRET)
}

// Returns the Intervals.icu API key if the request carries the right secret,
// otherwise undefined.
export function ownerKeyFromRequest(req) {
  const secret = process.env.MCP_ACCESS_SECRET
  const key = process.env.INTERVALS_API_KEY
  if (!secret || !key || secret.length < MIN_SECRET_LENGTH) return undefined

  const given = new URL(req.url).searchParams.get("k")
  if (!given) return undefined

  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  return key
}
