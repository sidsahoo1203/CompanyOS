import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { asActor, authPool, tenantPool } from "@/lib/db";
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  inviteMember,
  acceptInvitation,
  changeMemberRole,
} from "@/lib/workspaces";
const suffix = randomUUID();
const users = {
  owner: "owner-" + suffix,
  other: "other-" + suffix,
  member: "member-" + suffix,
  admin: "admin-" + suffix,
  outsider: "outsider-" + suffix,
};
const email = (id: string) => id + "@test.example";
const input = {
  name: "Agency A",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en" as const,
  retentionDays: 90 as const,
};
let a: string, b: string;
const migration = new Pool({
  connectionString: process.env.TEST_MIGRATION_DATABASE_URL,
});
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.pathname !== "/companyos_test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error(
      "Tests require the isolated local companyos_test database.",
    );
  for (const [name, id] of Object.entries(users))
    await authPool().query(
      'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',
      [id, name, email(id)],
    );
  a = await createWorkspace(users.owner, input);
  b = await createWorkspace(users.other, { ...input, name: "Agency B" });
  for (const [id, role] of [
    [users.member, "member"],
    [users.admin, "admin"],
  ] as const) {
    const invitation = await inviteMember(users.owner, a, email(id), role);
    await acceptInvitation(id, invitation.token);
  }
});
afterAll(async () => {
  await authPool().end();
  await tenantPool().end();
  await migration.end();
});
describe("real PostgreSQL workspace isolation", () => {
  it("creates one owner and lists only the actor's workspaces", async () => {
    expect((await listWorkspaces(users.owner)).map((item) => item.id)).toEqual([
      a,
    ]);
    expect(
      (await getWorkspace(users.owner, a)).members.filter(
        (item) => item.role === "owner",
      ),
    ).toHaveLength(1);
  });
  it("rejects another tenant at the service boundary", async () => {
    await expect(getWorkspace(users.member, b)).rejects.toMatchObject({
      status: 404,
    });
    await expect(updateWorkspace(users.member, b, input)).rejects.toMatchObject(
      { status: 404 },
    );
  });
  it("RLS hides another workspace even with an unfiltered query or forged workspace context", async () => {
    const rows = await asActor(
      users.member,
      b,
      async (db) => (await db.query("SELECT * FROM app.workspace")).rows,
    );
    expect(rows).toEqual([]);
    expect(
      await asActor(
        users.member,
        b,
        async (db) =>
          (await db.query("SELECT * FROM app.workspace_membership")).rows,
      ),
    ).toEqual([]);
  });
  it("the runtime role is neither a superuser nor an RLS bypass role", async () => {
    const result = await tenantPool().query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(
      tenantPool().query("SELECT * FROM public.session"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tenantPool().query("UPDATE app.workspace SET name='Bypass'"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("database functions independently refuse member settings changes", async () => {
    await expect(
      asActor(users.member, a, (db) =>
        db.query("SELECT app.update_workspace($1,$2,$3,$4,$5,$6)", [
          a,
          "Attack",
          "Agency",
          "UTC",
          "en",
          90,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(updateWorkspace(users.member, a, input)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("admins can edit settings but cannot change roles or invite admins", async () => {
    await updateWorkspace(users.admin, a, {
      ...input,
      name: "Agency A Updated",
    });
    expect((await getWorkspace(users.member, a)).workspace.name).toBe(
      "Agency A Updated",
    );
    await expect(
      changeMemberRole(users.admin, a, users.member, "admin"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      inviteMember(users.admin, a, email(users.outsider), "admin"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("owner changes are effective immediately and the owner cannot be demoted", async () => {
    await changeMemberRole(users.owner, a, users.member, "admin");
    await updateWorkspace(users.member, a, input);
    await changeMemberRole(users.owner, a, users.member, "member");
    await expect(updateWorkspace(users.member, a, input)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      changeMemberRole(users.owner, a, users.owner, "member"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("invitation acceptance is email bound and only one concurrent attempt succeeds", async () => {
    const invitation = await inviteMember(
      users.owner,
      a,
      email(users.outsider),
      "member",
    );
    await expect(
      acceptInvitation(users.other, invitation.token),
    ).rejects.toMatchObject({ code: "P0002" });
    const attempts = await Promise.allSettled([
      acceptInvitation(users.outsider, invitation.token),
      acceptInvitation(users.outsider, invitation.token),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await expect(
      acceptInvitation(users.outsider, invitation.token),
    ).rejects.toMatchObject({ code: "P0002" });
  });
  it("expired invitations cannot be used", async () => {
    const invitation = await inviteMember(
      users.other,
      b,
      email(users.member),
      "member",
    );
    await migration.query(
      "UPDATE app.invitation SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [invitation.id],
    );
    await expect(
      acceptInvitation(users.member, invitation.token),
    ).rejects.toMatchObject({ code: "P0002" });
  });
  it("invitation replacement invalidates the old token", async () => {
    const old = await inviteMember(
      users.other,
      b,
      email(users.admin),
      "member",
    );
    await inviteMember(users.other, b, email(users.admin), "member");
    await expect(
      acceptInvitation(users.admin, old.token),
    ).rejects.toMatchObject({ code: "P0002" });
  });
  it("transaction-local actor context does not leak after rollback or commit", async () => {
    await expect(
      asActor(users.owner, a, async () => {
        throw new Error("Rollback");
      }),
    ).rejects.toThrow("Rollback");
    expect(
      (await tenantPool().query("SELECT * FROM app.workspace")).rows,
    ).toEqual([]);
    await asActor(users.owner, a, (db) => db.query("SELECT 1"));
    expect(
      (await tenantPool().query("SELECT * FROM app.workspace")).rows,
    ).toEqual([]);
  });
  it("audit events contain no secrets or invitation tokens; members cannot read admin events", async () => {
    const events = await asActor(users.owner, a, (db) =>
      db.query("SELECT * FROM app.audit_event"),
    );
    expect(events.rowCount).toBeGreaterThan(0);
    for (const event of events.rows)
      expect(
        Object.keys(event.metadata).every((key) =>
          ["previousRole", "role"].includes(key),
        ),
      ).toBe(true);
    expect(JSON.stringify(events.rows)).not.toMatch(
      /password|token|postgresql|accessToken/i,
    );
    expect(
      (
        await asActor(users.member, a, (db) =>
          db.query("SELECT * FROM app.audit_event"),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      asActor(users.owner, a, (db) =>
        db.query("SELECT token_hash FROM app.invitation"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
