// Production start command for Render (or any single-container Node host).
// 1. Sets up the restricted roles and applies migrations with the owner URL.
// 2. Starts Next.js with runtime URLs for the restricted roles only; the owner
//    URL and raw role passwords are removed from the web server's environment.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
if (process.env.APP_MODE !== "production")
  throw new Error("render-start is for APP_MODE=production only.");
const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) throw new Error("MIGRATION_DATABASE_URL is required.");
for (const script of ["scripts/db-setup-roles.mjs", "scripts/migrate.mjs"]) {
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const runtimeUrl = (role, password) => {
  const url = new URL(owner);
  url.username = role;
  url.password = password;
  return url.toString();
};
const env = {
  ...process.env,
  DATABASE_URL: runtimeUrl("companyos_app", process.env.APP_DB_PASSWORD),
  AUTH_DATABASE_URL: runtimeUrl("companyos_auth", process.env.AUTH_DB_PASSWORD),
};
for (const key of [
  "MIGRATION_DATABASE_URL",
  "APP_DB_PASSWORD",
  "AUTH_DB_PASSWORD",
])
  delete env[key];
const next = spawn(
  process.execPath,
  [
    path.resolve("node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    process.env.PORT ?? "3000",
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => next.kill(signal));
next.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
