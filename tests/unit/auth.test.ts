import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options: Record<string, unknown>) => ({ options })),
  handler: vi.fn(),
}));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: mocks.handler, POST: mocks.handler }),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    BETTER_AUTH_SECRET: "s".repeat(32),
  }),
}));
vi.mock("@/lib/db", () => ({ authPool: () => "auth-pool" }));
import { getAuth } from "@/lib/auth";
import { GET, POST } from "@/app/api/auth/[...all]/route";
type Options = {
  baseURL: string;
  trustedOrigins: string[];
  database: unknown;
  emailAndPassword: Record<string, unknown>;
  session: Record<string, unknown>;
  rateLimit: Record<string, unknown>;
  advanced: { ipAddress: { ipAddressHeaders: string[] } };
  logger: { log: (level: string, message: string, ...args: unknown[]) => void };
};
const options = () => (getAuth() as unknown as { options: Options }).options;
afterEach(() => {
  vi.restoreAllMocks();
  mocks.handler.mockReset();
});
describe("authentication configuration", () => {
  it("is created once and uses the restricted auth pool", () => {
    expect(getAuth()).toBe(getAuth());
    expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
    expect(options().database).toBe("auth-pool");
    expect(options().baseURL).toBe("http://127.0.0.1:3000");
    expect(options().trustedOrigins).toEqual(["http://127.0.0.1:3000"]);
  });
  it("enforces password length and database-backed sessions without cookie caching", () => {
    expect(options().emailAndPassword).toMatchObject({
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    });
    expect(options().session).toMatchObject({
      expiresIn: 604800,
      cookieCache: { enabled: false },
    });
  });
  it("rate-limits sign-in and sign-up to 10 per minute in database storage", () => {
    expect(options().rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
      },
    });
    expect(options().advanced.ipAddress.ipAddressHeaders).toEqual([
      "x-companyos-client-ip",
    ]);
  });
  it("routes library logs through the redacting logger and drops extra arguments", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    options().logger.log("warn", 'User "Jane" ceo@agency.example failed', {
      password: "secret",
    });
    options().logger.log("error", "Invalid origin: https://evil.example");
    const line = JSON.parse(warn.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "warn", event: "auth.library" });
    expect(JSON.stringify(line)).not.toMatch(/Jane|ceo@agency|secret/);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(error.mock.calls[0][0] as string).level).toBe("error");
  });
});
describe("auth route wrapper", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  it("never trusts a client-supplied IP header for rate limiting", async () => {
    mocks.handler.mockResolvedValue(new Response("{}"));
    await POST(
      post(JSON.stringify({ email: "a@b.example" }), {
        "x-companyos-client-ip": "203.0.113.9",
      }),
    );
    const forwarded: Request = mocks.handler.mock.calls[0][0];
    expect(forwarded.headers.get("x-companyos-client-ip")).toBe("127.0.0.1");
    expect(await forwarded.json()).toEqual({ email: "a@b.example" });
  });
  it("forces password changes to revoke other sessions", async () => {
    mocks.handler.mockResolvedValue(new Response("{}"));
    const change = new Request(
      "http://127.0.0.1:3000/api/auth/change-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: "a",
          newPassword: "b",
          revokeOtherSessions: false,
        }),
      },
    );
    await POST(change);
    expect(await mocks.handler.mock.calls[0][0].json()).toMatchObject({
      revokeOtherSessions: true,
    });
    await POST(
      post(
        JSON.stringify({ email: "a@b.example", revokeOtherSessions: false }),
      ),
    );
    expect(await mocks.handler.mock.calls[1][0].json()).toMatchObject({
      revokeOtherSessions: false,
    });
  });
  it("marks auth responses private and uncacheable", async () => {
    mocks.handler.mockResolvedValue(
      new Response("{}", { headers: { "Cache-Control": "public" } }),
    );
    const response = await GET(
      new Request("http://127.0.0.1:3000/api/auth/get-session"),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.handler.mock.calls[0][0].method).toBe("GET");
  });
  it("rejects oversized and malformed bodies before the library sees them", async () => {
    const large = await POST(post(JSON.stringify({ x: "y".repeat(20000) })));
    expect(large.status).toBe(413);
    const broken = await POST(post("{not json"));
    expect(broken.status).toBe(400);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it("treats a non-object JSON body as invalid input, not a server failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(post("[1,2,3]"));
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it("unexpected library failures return a logged reference without internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handler.mockRejectedValue(new Error("pool exhausted at host db-1"));
    const response = await POST(post("{}"));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.error).toContain("Reference: " + result.reference);
    expect(result.error).not.toContain("db-1");
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      event: "auth.unexpected_error",
      reference: result.reference,
    });
  });
});
