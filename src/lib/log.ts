import "server-only";
import { randomUUID } from "node:crypto";
type Fields = Record<string, string | number | boolean | null | undefined>;
// Database and parser messages can echo user data (values, emails); strip them.
export function redact(value: string) {
  return value
    .replace(/"[^"\n]*"|'[^'\n]*'/g, "[redacted]")
    .replace(/[^\s@()<>"']+@[^\s@()<>"']+/g, "[email]")
    .replace(/=\([^)\n]*\)/g, "=([redacted])")
    .slice(0, 500);
}
// One JSON line per event on stderr/stdout; never request bodies, documents or drafts.
export function logEvent(
  level: "error" | "warn" | "info",
  event: string,
  fields: Fields = {},
) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
// Logs an unexpected failure with only diagnostic metadata; returns a reference
// that the client can quote so the log line can be found.
export function logUnexpected(
  event: string,
  error: unknown,
  fields: Fields = {},
) {
  const reference = randomUUID();
  const detail = (typeof error === "object" && error !== null ? error : {}) as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    constraint?: unknown;
    table?: unknown;
    routine?: unknown;
    stack?: unknown;
  };
  const text = (value: unknown) =>
    typeof value === "string" ? redact(value) : undefined;
  logEvent("error", event, {
    reference,
    ...fields,
    errorName: text(detail.name),
    code: text(detail.code),
    constraint: text(detail.constraint),
    table: text(detail.table),
    routine: text(detail.routine),
    message: text(detail.message ?? (typeof error === "string" ? error : "")),
    stack:
      typeof detail.stack === "string"
        ? redact(detail.stack.split("\n").slice(1, 6).join(" | "))
        : undefined,
  });
  return reference;
}
