import "server-only";
import { isIP } from "node:net";
// The address used to key authentication rate limits.
// Local mode serves loopback only, so every request shares one bucket and
// client-supplied forwarding headers are ignored. Behind Render's proxy the
// first X-Forwarded-For entry is the client address Render observed; if it is
// missing or malformed, requests fall into one shared fail-closed bucket.
export function clientIp(headers: Headers, production: boolean) {
  if (!production) return "127.0.0.1";
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(first) ? first : "0.0.0.0";
}
