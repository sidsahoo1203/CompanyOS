import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const port = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PLAYWRIGHT_PORT must be a local unprivileged port.");
const origin = "http://127.0.0.1:" + port;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port " +
      port,
    url: origin,
    // Explicit local opt-in avoids managing a server's lifecycle during manual verification.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120000,
    env: {
      APP_MODE: "local",
      BETTER_AUTH_URL: origin,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      AUTH_DATABASE_URL: process.env.TEST_AUTH_DATABASE_URL ?? "",
    },
  },
});
