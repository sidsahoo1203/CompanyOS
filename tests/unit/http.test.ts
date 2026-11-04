import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const session = vi.hoisted(() => ({
  value: { user: { id: "user-1" } } as unknown,
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => session.value } }),
}));
import { api, body, noStore } from "@/lib/http";
import { AppError, publicError } from "@/lib/errors";
import { readUpload } from "@/lib/upload-body";
import { MAX_FILE_BYTES } from "@/lib/knowledge-validation";
import { requestJson } from "@/lib/client";
const origin = "http://127.0.0.1:3000";
const post = (headers: Record<string, string>, payload = "{}") =>
  new Request(origin + "/api/x", { method: "POST", headers, body: payload });
const ok = async () => ({ fine: true });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  session.value = { user: { id: "user-1" } };
});
describe("publicError", () => {
  it.each([
    ["42501", 403],
    ["54000", 429],
    ["55000", 409],
    ["P0002", 404],
    ["23505", 409],
    ["22023", 400],
    ["23514", 400],
    ["23502", 400],
    ["08006", 503],
    ["", 503],
  ])(
    "maps database code '%s' to %i without echoing the database message",
    (code, status) => {
      const result = publicError(
        Object.assign(new Error("relation app.secret_table leaked"), { code }),
      );
      expect(result.status).toBe(status);
      expect(result.message).not.toContain("secret_table");
    },
  );
  it("passes AppError status and message through, and handles non-errors", () => {
    expect(publicError(new AppError(418, "Teapot."))).toEqual({
      status: 418,
      message: "Teapot.",
    });
    expect(publicError("boom").status).toBe(503);
    expect(publicError(null).status).toBe(503);
  });
});
describe("api() request guard", () => {
  it.each([
    ["no Origin", { "content-type": "application/json" }],
    [
      "a foreign Origin",
      { origin: "https://evil.example", "content-type": "application/json" },
    ],
    [
      "cross-site Fetch Metadata",
      {
        origin,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
    ],
    [
      "same-site Fetch Metadata",
      {
        origin,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
      },
    ],
  ])(
    "rejects writes with %s (403) before running the action",
    async (_, headers) => {
      const action = vi.fn(ok);
      const response = await api(post(headers), action);
      expect(response.status).toBe(403);
      expect(action).not.toHaveBeenCalled();
    },
  );
  it("accepts same-origin writes with or without Fetch Metadata", async () => {
    const variants: Record<string, string>[] = [
      {},
      { "sec-fetch-site": "same-origin" },
    ];
    for (const extra of variants) {
      const response = await api(
        post({ origin, "content-type": "application/json", ...extra }),
        ok,
      );
      expect(response.status).toBe(200);
    }
  });
  it("requires JSON for writes, and octet-stream for uploads (415)", async () => {
    expect(
      (await api(post({ origin, "content-type": "text/plain" }), ok)).status,
    ).toBe(415);
    expect(
      (
        await api(
          post({ origin, "content-type": "application/json" }),
          ok,
          true,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await api(
          post({ origin, "content-type": "application/octet-stream" }),
          ok,
          true,
        )
      ).status,
    ).toBe(200);
  });
  it("reads need no Origin but do need a session (401)", async () => {
    expect((await api(new Request(origin + "/api/x"), ok)).status).toBe(200);
    session.value = null;
    const action = vi.fn(ok);
    const response = await api(new Request(origin + "/api/x"), action);
    expect(response.status).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });
  it("passes the session user id to the action and never caches responses", async () => {
    const action = vi.fn(async (user: string) => ({ user }));
    const response = await api(new Request(origin + "/api/x"), action);
    expect(await response.json()).toEqual({ user: "user-1" });
    expect(response.headers.get("cache-control")).toBe(
      noStore["Cache-Control"],
    );
    expect(action).toHaveBeenCalledWith("user-1");
  });
  it("schema failures return a generic 400 without validation internals", async () => {
    const response = await api(new Request(origin + "/api/x"), async () =>
      z.object({ secretField: z.string() }).parse({}),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Check the supplied details.");
    expect(text).not.toContain("secretField");
  });
});
describe("body()", () => {
  const schema = z.object({ a: z.string() }).strict();
  const request = (
    payload: BodyInit | null,
    headers: Record<string, string> = {},
  ) => new Request(origin, { method: "POST", body: payload, headers });
  it("rejects a declared oversize body without reading it", async () => {
    const req = request("{}", { "content-length": "16385" });
    await expect(body(req, schema)).rejects.toMatchObject({ status: 413 });
    expect(req.bodyUsed).toBe(false);
  });
  it("accepts exactly 16 KiB and rejects one byte more when streamed", async () => {
    const exact = JSON.stringify({ a: "x".repeat(16384 - 8) });
    expect(exact.length).toBe(16384);
    await expect(body(request(exact), schema)).resolves.toEqual({
      a: "x".repeat(16376),
    });
    await expect(body(request(exact + " "), schema)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("requires a body, valid JSON and the exact schema", async () => {
    await expect(body(request(null), schema)).rejects.toMatchObject({
      status: 400,
    });
    await expect(body(request("{nope"), schema)).rejects.toMatchObject({
      status: 400,
      message: "Invalid JSON.",
    });
    await expect(
      body(request(JSON.stringify({ a: "x", role: "owner" })), schema),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
describe("readUpload()", () => {
  const upload = (
    payload: BodyInit | null,
    headers: Record<string, string> = {},
  ) =>
    new Request(origin, {
      method: "POST",
      body: payload,
      headers,
      ...(payload instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  it("accepts exactly 5 MiB and refuses a declared or streamed byte more", async () => {
    expect(
      (await readUpload(upload(new Uint8Array(MAX_FILE_BYTES)))).length,
    ).toBe(MAX_FILE_BYTES);
    await expect(
      readUpload(upload("x", { "content-length": String(MAX_FILE_BYTES + 1) })),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readUpload(upload(new Uint8Array(MAX_FILE_BYTES + 1))),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("requires a body", async () => {
    await expect(readUpload(upload(null))).rejects.toMatchObject({
      status: 400,
    });
  });
  it("aborts a stalled upload after 15 seconds (408)", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
    });
    const pending = readUpload(upload(stalled));
    const assertion = expect(pending).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
});
describe("requestJson() browser client", () => {
  const reply = (status: number, payload: unknown, raw = false) =>
    vi.fn(
      async () =>
        new Response(raw ? (payload as string) : JSON.stringify(payload), {
          status,
        }),
    );
  it("sends JSON with the method and returns the parsed body", async () => {
    const fetch = reply(200, { id: "x" });
    vi.stubGlobal("fetch", fetch);
    expect(await requestJson("/api/a", "PATCH", { b: 1 })).toEqual({ id: "x" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/a");
    expect(init).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"b":1}',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("surfaces the server's safe error message, then a message field, then a fallback", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "Already decided." }));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "Already decided.",
    );
    vi.stubGlobal("fetch", reply(400, { message: "Bad input." }));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow("Bad input.");
    vi.stubGlobal("fetch", reply(500, { error: { nested: true } }));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "This request could not be completed.",
    );
  });
  it("network failures become a friendly connection message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "The request could not finish. Check your connection and try again.",
    );
  });
  it("non-JSON error pages (for example a proxy's HTML) still give a friendly message", async () => {
    vi.stubGlobal("fetch", reply(502, "<html>Bad gateway</html>", true));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "This request could not be completed.",
    );
    vi.stubGlobal("fetch", reply(200, "<html>Login portal</html>", true));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "The server sent an unreadable response. Try again.",
    );
    vi.stubGlobal("fetch", reply(400, { message: { nested: true } }));
    await expect(requestJson("/a", "POST", {})).rejects.toThrow(
      "This request could not be completed.",
    );
  });
});
