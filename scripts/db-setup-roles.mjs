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
    const existing = (
      await client.query(
        "SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS privileged FROM pg_roles WHERE rolname = $1",
        [role],
      )
    ).rows[0];
    // A managed database owner is not a superuser: it may set these
    // attributes when creating a role, but ALTER ROLE may only change the
    // password. Existing roles are instead checked to be unprivileged.
    if (existing?.privileged)
      throw new Error(
        "Role " +
          role +
          " has elevated privileges. Remove them (NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE) before deploying.",
      );
    // Role names are fixed above; the password is quoted by the driver.
    const statement = existing
      ? 'ALTER ROLE "' +
        role +
        '" WITH LOGIN PASSWORD ' +
        client.escapeLiteral(password)
      : 'CREATE ROLE "' +
        role +
        '" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ' +
        client.escapeLiteral(password);
    try {
      await client.query(statement);
    } catch (error) {
      if (error.code === "42501")
        throw new Error(
          "The database owner may not " +
            (existing ? "update" : "create") +
            " role " +
            role +
            ". Create or update companyos_app and companyos_auth with your provider's tools, then deploy again.",
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
    console.log((existing ? "Updated role " : "Created role ") + role);
  }
} finally {
  await client.end();
}
