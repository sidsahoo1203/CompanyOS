import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
const root = process.cwd();
if (process.env.NODE_ENV === "production")
  throw new Error("Local database setup is disabled in production.");
const dir = path.join(root, "work", "postgres");
const configPath = path.join(root, "work", "local-db.json");
mkdirSync(path.dirname(configPath), { recursive: true });
let config;
if (existsSync(configPath))
  config = JSON.parse(readFileSync(configPath, "utf8"));
else {
  config = {
    admin: randomBytes(24).toString("hex"),
    app: randomBytes(24).toString("hex"),
    auth: randomBytes(24).toString("hex"),
    secret: randomBytes(48).toString("hex"),
    seed: randomBytes(18).toString("base64url") + "1aA!",
  };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
}
const database = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: config.admin,
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(path.join(dir, "PG_VERSION"))) await database.initialise();
await database.start();
const admin = new pg.Client({
  host: "127.0.0.1",
  port: 55432,
  user: "postgres",
  password: config.admin,
  database: "postgres",
});
await admin.connect();
for (const [role, password] of [
  ["companyos_app", config.app],
  ["companyos_auth", config.auth],
]) {
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]))
      .rowCount
  ) {
    // Identifiers and hex passwords are generated here, never supplied by a request.
    await admin.query(
      'CREATE ROLE "' +
        role +
        '" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ' +
        "'" +
        password +
        "'",
    );
  }
}
for (const name of ["companyos_dev", "companyos_test"]) {
  const existing = await admin.query(
    "SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1",
    [name],
  );
  // The OS default (for example WIN1252) cannot store many names, currencies or scripts.
  if (!existing.rowCount)
    await admin.query(
      'CREATE DATABASE "' +
        name +
        "\" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0",
    );
  else if (existing.rows[0].encoding !== "UTF8")
    console.warn(
      name +
        " uses " +
        existing.rows[0].encoding +
        ", not UTF8. Rename it (no data is deleted) and restart this helper to create a UTF8 database; see README.",
    );
}
await admin.end();
const url = (role, password, name) =>
  `postgresql://${role}:${password}@127.0.0.1:55432/${name}`;
if (!existsSync(".env.local"))
  writeFileSync(
    ".env.local",
    [
      "APP_MODE=local",
      "BETTER_AUTH_URL=http://127.0.0.1:3000",
      "BETTER_AUTH_SECRET=" + config.secret,
      "DATABASE_URL=" + url("companyos_app", config.app, "companyos_dev"),
      "AUTH_DATABASE_URL=" +
        url("companyos_auth", config.auth, "companyos_dev"),
      "MIGRATION_DATABASE_URL=" +
        url("postgres", config.admin, "companyos_dev"),
      "TEST_DATABASE_URL=" + url("companyos_app", config.app, "companyos_test"),
      "TEST_AUTH_DATABASE_URL=" +
        url("companyos_auth", config.auth, "companyos_test"),
      "TEST_MIGRATION_DATABASE_URL=" +
        url("postgres", config.admin, "companyos_test"),
      "SEED_PASSWORD=" + config.seed,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
console.log(
  "Local PostgreSQL is ready on 127.0.0.1:55432. Credentials are in ignored .env.local. Keep this terminal open.",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await database.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
