import "server-only";
import { Pool, type PoolClient } from "pg";
import { env } from "./env";
const globalDb = globalThis as unknown as {
  tenantPool?: Pool;
  authPool?: Pool;
};
const options = {
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
};
export function tenantPool() {
  return (globalDb.tenantPool ??= new Pool({
    connectionString: env().DATABASE_URL,
    ...options,
  }));
}
export function authPool() {
  return (globalDb.authPool ??= new Pool({
    connectionString: env().AUTH_DATABASE_URL,
    ...options,
  }));
}
export async function asActor<T>(
  userId: string,
  workspaceId: string | null,
  operation: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await tenantPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
      [userId, workspaceId ?? ""],
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
