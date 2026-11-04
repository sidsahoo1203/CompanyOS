// Creates (or re-keys) the two restricted runtime roles on a hosted database.
// Runs before migrations, which grant these roles their narrow privileges.
// Local development uses scripts/local-db.mjs instead.
import pg from "pg";
if (process.env.APP_MODE !== "production")
  throw new Error("db-setup-roles is for APP_MODE=production only.");
const owner = process.env.MIGRATION_DATABASE_URL;
const passwords = {
  companyos_app: process.env.APP_DB_PASSWORD,
  companyos_auth: process.env.AUTH_DB_PASSWORD,
};
if (!owner) throw new Error("MIGRATION_DATABASE_URL is required.");
for (const [role, password] of Object.entries(passwords))
  if (!password || password.length < 24)
    throw new Error(
      (role === "companyos_app" ? "APP" : "AUTH") +
        "_DB_PASSWORD must be set to at least 24 random characters.",
    );
const client = new pg.Client({ connectionString: owner });
await client.connect();
try {
  const database = (await client.query("SELECT current_database() AS name"))
    .rows[0].name;
  for (const [role, password] of Object.entries(passwords)) {
    const exists = (
      await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])
    ).rowCount;
    // Role names are fixed above; the password is quoted by the driver.
    const attributes =
      "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD " +
      client.escapeLiteral(password);
    try {
      await client.query(
        (exists ? 'ALTER ROLE "' : 'CREATE ROLE "') + role + '" ' + attributes,
      );
    } catch (error) {
      if (error.code === "42501")
        throw new Error(
          "The database owner may not create roles. Create the roles companyos_app and companyos_auth with your provider's tools, then deploy again.",
        );
      throw error;
    }
    await client.query(
      "GRANT CONNECT ON DATABASE " +
        client.escapeIdentifier(database) +
        ' TO "' +
        role +
        '"',
    );
    console.log((exists ? "Updated role " : "Created role ") + role);
  }
} finally {
  await client.end();
}
