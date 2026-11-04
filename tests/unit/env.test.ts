import { afterEach, describe, expect, it, vi } from "vitest";
const valid = {
  APP_MODE: "local",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
  DATABASE_URL: "postgresql://companyos_app:pw@127.0.0.1:55432/companyos_dev",
  AUTH_DATABASE_URL:
    "postgresql://companyos_auth:pw@localhost:55432/companyos_dev",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
};
const hosted = {
  APP_MODE: "production",
  BETTER_AUTH_URL: "https://app.companyos.example",
  DATABASE_URL:
    "postgresql://companyos_app:pw@dpg-abc123-a.internal:5432/companyos",
  AUTH_DATABASE_URL:
    "postgresql://companyos_auth:pw@dpg-abc123-a.internal:5432/companyos",
  RESEND_API_KEY: "re_test_1234567890",
  EMAIL_FROM: "CompanyOS <no-reply@companyos.example>",
};
// env() caches its first result, so each case loads a fresh module.
async function load(over: Partial<Record<keyof typeof valid, string>>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...valid, ...over }))
    vi.stubEnv(key, value);
  return (await import("@/lib/env")).env;
}
afterEach(() => vi.unstubAllEnvs());
describe("runtime configuration guard", () => {
  it("accepts a complete local configuration and caches it", async () => {
    const env = await load({});
    const first = env();
    expect(first.APP_MODE).toBe("local");
    vi.stubEnv("APP_MODE", "production");
    expect(env()).toBe(first);
  });
  it.each([
    ["APP_MODE", "staging"],
    ["APP_MODE", ""],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["BETTER_AUTH_URL", "not a url"],
    ["DATABASE_URL", "mysql://companyos_app@127.0.0.1/db"],
  ])("rejects %s=%s with a setup hint and no values", async (key, value) => {
    const env = await load({ [key]: value });
    expect(() => env()).toThrow(
      "CompanyOS configuration is missing. Follow README.md for setup.",
    );
  });
  it.each([
    ["BETTER_AUTH_URL", "https://companyos.example.com"],
    ["DATABASE_URL", "postgresql://companyos_app:pw@db.example.com:5432/app"],
    ["AUTH_DATABASE_URL", "postgresql://companyos_auth:pw@10.0.0.5:5432/app"],
    ["DATABASE_URL", "postgresql://companyos_app:pw@0.0.0.0:55432/app"],
  ])("local mode refuses non-loopback %s", async (key, value) => {
    const env = await load({ [key]: value });
    expect(() => env()).toThrow(/Local mode permits local services only/);
  });
  it.each([
    ["DATABASE_URL", "postgresql://postgres:pw@127.0.0.1:55432/companyos_dev"],
    [
      "DATABASE_URL",
      "postgresql://companyos_auth:pw@127.0.0.1:55432/companyos_dev",
    ],
    [
      "AUTH_DATABASE_URL",
      "postgresql://companyos_app:pw@127.0.0.1:55432/companyos_dev",
    ],
  ])("requires the restricted runtime roles (%s)", async (key, value) => {
    const env = await load({ [key]: value });
    expect(() => env()).toThrow(
      "Use the restricted CompanyOS runtime database roles.",
    );
  });
  it("never echoes secrets in its errors", async () => {
    const env = await load({
      BETTER_AUTH_SECRET: "leak-me",
      DATABASE_URL: "postgresql://postgres:hunter2@127.0.0.1/x",
    });
    try {
      env();
    } catch (error) {
      expect(String(error)).not.toMatch(/leak-me|hunter2/);
    }
  });
});
describe("production configuration", () => {
  it("accepts a hosted database and an https origin with email settings", async () => {
    const env = await load(hosted);
    expect(env()).toMatchObject({
      APP_MODE: "production",
      EMAIL_FROM: "CompanyOS <no-reply@companyos.example>",
    });
  });
  it.each([
    ["RESEND_API_KEY", ""],
    ["RESEND_API_KEY", "not-a-resend-key"],
    ["EMAIL_FROM", ""],
  ])("requires email settings (%s=%s)", async (key, value) => {
    const env = await load({ ...hosted, [key]: value });
    expect(() => env()).toThrow(/configuration is missing/);
  });
  it.each([
    "http://app.companyos.example",
    "https://app.companyos.example/",
    "https://app.companyos.example/app",
    "https://localhost",
  ])("requires a bare public https origin, not %s", async (url) => {
    const env = await load({ ...hosted, BETTER_AUTH_URL: url });
    expect(() => env()).toThrow(/public https:\/\/ origin/);
  });
  it("still requires the restricted roles", async () => {
    const env = await load({
      ...hosted,
      DATABASE_URL: "postgresql://companyos_owner:pw@db.internal/companyos",
    });
    expect(() => env()).toThrow(
      "Use the restricted CompanyOS runtime database roles.",
    );
  });
});
