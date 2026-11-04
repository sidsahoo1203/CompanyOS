import { beforeEach, describe, expect, it, vi } from "vitest";
const pg = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  const pools: { options: Record<string, unknown> }[] = [];
  class Pool {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      pools.push(this);
    }
    connect = vi.fn(async () => client);
  }
  return { client, pools, Pool };
});
vi.mock("pg", () => ({ Pool: pg.Pool }));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgresql://companyos_app@127.0.0.1/companyos_test",
    AUTH_DATABASE_URL: "postgresql://companyos_auth@127.0.0.1/companyos_test",
  }),
}));
import { asActor, tenantPool, authPool } from "@/lib/db";
beforeEach(() => {
  pg.client.query.mockReset().mockResolvedValue({ rows: [] });
  pg.client.release.mockReset();
});
const statements = () => pg.client.query.mock.calls.map((call) => call[0]);
describe("connection pools", () => {
  it("are singletons with separate credentials and bounded timeouts", () => {
    expect(tenantPool()).toBe(tenantPool());
    expect(authPool()).toBe(authPool());
    expect(tenantPool()).not.toBe(authPool());
    const [tenant, auth] = pg.pools;
    expect(tenant.options).toMatchObject({
      connectionString: "postgresql://companyos_app@127.0.0.1/companyos_test",
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    expect(auth.options.connectionString).toContain("companyos_auth");
  });
});
describe("asActor", () => {
  it("sets transaction-local actor and workspace, commits and releases", async () => {
    const result = await asActor("u1", "w1", async (db) => {
      await db.query("SELECT 1");
      return "done";
    });
    expect(result).toBe("done");
    expect(statements()).toEqual([
      "BEGIN",
      expect.stringContaining("set_config('app.user_id', $1, true)"),
      "SELECT 1",
      "COMMIT",
    ]);
    expect(pg.client.query.mock.calls[1][1]).toEqual(["u1", "w1"]);
    expect(pg.client.release).toHaveBeenCalledTimes(1);
  });
  it("uses an empty workspace setting when acting outside a workspace", async () => {
    await asActor("u1", null, async () => undefined);
    expect(pg.client.query.mock.calls[1][1]).toEqual(["u1", ""]);
  });
  it("rolls back, rethrows the original error and still releases on failure", async () => {
    const failure = new Error("boom");
    await expect(
      asActor("u1", "w1", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(statements()).toEqual([
      "BEGIN",
      expect.stringContaining("set_config"),
      "ROLLBACK",
    ]);
    expect(statements()).not.toContain("COMMIT");
    expect(pg.client.release).toHaveBeenCalledTimes(1);
  });
  it("rolls back when setting the context itself fails", async () => {
    pg.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("set_config")) throw new Error("bad context");
      return { rows: [] };
    });
    const operation = vi.fn();
    await expect(asActor("u1", "w1", operation)).rejects.toThrow("bad context");
    expect(operation).not.toHaveBeenCalled();
    expect(statements()).toContain("ROLLBACK");
    expect(pg.client.release).toHaveBeenCalledTimes(1);
  });
});
