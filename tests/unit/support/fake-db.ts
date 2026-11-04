import { vi } from "vitest";
// A scripted stand-in for a pg client: each handler matches SQL by substring or
// regex and returns rows (or throws). Unmatched SQL fails the test loudly, so a
// service can never silently run a query the test did not anticipate.
type Rows = Record<string, unknown>[];
export type Handler = [
  match: string | RegExp,
  result: Rows | Error | ((params: unknown[]) => Rows | Promise<Rows>),
];
export type Call = { sql: string; params: unknown[] };
export function fakeClient(handlers: Handler[]) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [match, result] of handlers)
      if (typeof match === "string" ? sql.includes(match) : match.test(sql)) {
        if (result instanceof Error) throw result;
        const rows =
          typeof result === "function" ? await result(params) : result;
        return { rows, rowCount: rows.length };
      }
    throw new Error("Unexpected SQL in test: " + sql.slice(0, 120));
  });
  return { client: { query }, calls };
}
export function pgError(code: string, message = "database refusal") {
  return Object.assign(new Error(message), { code });
}
export const role = (value: string | null) =>
  [
    "SELECT app.role_for($1) AS role",
    value ? [{ role: value }] : [],
  ] as Handler;
