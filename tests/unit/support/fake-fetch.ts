import { vi } from "vitest";
// Routes "METHOD path" (or a function) to a JSON reply; records every request.
type Reply = { status?: number; body?: unknown } | Error;
type Route = (init: RequestInit & { url: string }) => Reply | Promise<Reply>;
export type Sent = {
  method: string;
  url: string;
  body: unknown;
  headers: Headers;
};
export function fakeFetch(routes: Record<string, Reply | Route>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    let body: unknown = init.body;
    if (typeof body === "string")
      try {
        body = JSON.parse(body);
      } catch {
        // Non-JSON bodies (for example uploads) are kept as-is.
      }
    sent.push({ method, url, body, headers });
    const route = routes[method + " " + url];
    if (!route)
      throw new Error("Unexpected request in test: " + method + " " + url);
    const reply =
      typeof route === "function" ? await route({ ...init, url }) : route;
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, sent };
}
