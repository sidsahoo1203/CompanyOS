import { afterEach, describe, expect, it, vi } from "vitest";
const valid = {
  APP_MODE: "local",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
  DATABASE_URL: "postgresql://companyos_app:pw@127.0.0.1:55432/companyos_dev",
  AUTH_DATABASE_URL:
    "postgresql://companyos_auth:pw@localhost:55432/companyos_dev",
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
    ["APP_MODE", "production"],
    ["APP_MODE", ""],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["BETTER_AUTH_URL", "not a url"],
    ["DATABASE_URL", "mysql://companyos_app@127.0.0.1/db"],
  ])("rejects %s=%s with a setup hint and no values", async (key, value) => {
    const env = await load({ [key]: value });
    expect(() => env()).toThrow(
      "CompanyOS configuration is missing. Follow README.md for local setup.",
    );
  });
  it.each([
    ["BETTER_AUTH_URL", "https://companyos.example.com"],
    ["DATABASE_URL", "postgresql://companyos_app:pw@db.example.com:5432/app"],
    ["AUTH_DATABASE_URL", "postgresql://companyos_auth:pw@10.0.0.5:5432/app"],
    ["DATABASE_URL", "postgresql://companyos_app:pw@0.0.0.0:55432/app"],
  ])(
    "refuses non-loopback %s (public hosting is gated)",
    async (key, value) => {
      const env = await load({ [key]: value });
      expect(() => env()).toThrow(/local services only/);
    },
  );
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
