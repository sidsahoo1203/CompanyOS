import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({ path: ".env.local", quiet: true });
const port = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose an unprivileged local test port.");
for (const [source, target, role] of [
  ["TEST_DATABASE_URL", "DATABASE_URL", "companyos_app"],
  ["TEST_AUTH_DATABASE_URL", "AUTH_DATABASE_URL", "companyos_auth"],
]) {
  const value = process.env[source];
  if (!value) throw new Error("Local test configuration missing.");
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/companyos_test" ||
    url.username !== role
  )
    throw new Error(
      "The manual test server requires isolated local test roles and database.",
    );
  process.env[target] = value;
}
process.env.APP_MODE = "local";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:" + port;
process.argv = [
  process.execPath,
  fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(port),
];
await import("next/dist/bin/next");
