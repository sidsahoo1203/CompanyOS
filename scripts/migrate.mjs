import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const test = process.argv.includes("--test");
// A hosted deployment sets APP_MODE=production in its own environment and
// migrates its managed database; otherwise only the local databases qualify.
const production = process.env.APP_MODE === "production" && !test;
const connectionString =
  process.env[test ? "TEST_MIGRATION_DATABASE_URL" : "MIGRATION_DATABASE_URL"];
if (!connectionString) throw new Error("Migration database URL is required.");
const url = new URL(connectionString);
if (
  !production &&
  (!["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["companyos_dev", "companyos_test"].includes(url.pathname.slice(1)))
)
  throw new Error(
    "Outside APP_MODE=production the migration runner only permits local CompanyOS databases.",
  );
const label = test
  ? " (test)"
  : production
    ? " (production)"
    : " (development)";
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(491023)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.schema_migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("db/migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = await readFile("db/migrations/" + name, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = await client.query(
      "SELECT checksum FROM public.schema_migration WHERE name = $1",
      [name],
    );
    if (old.rowCount) {
      if (old.rows[0].checksum !== checksum)
        throw new Error("Applied migration changed: " + name);
      console.log("Already applied: " + name);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migration(name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log("Applied: " + name + label);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(491023)");
  await client.end();
}
