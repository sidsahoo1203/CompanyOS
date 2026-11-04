import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, role, type Handler } from "./support/fake-db";
const state = vi.hoisted(() => ({
  client: null as unknown,
  actors: [] as [string, string | null][],
}));
vi.mock("@/lib/db", () => ({
  asActor: vi.fn(
    async (
      user: string,
      workspace: string | null,
      op: (db: unknown) => unknown,
    ) => {
      state.actors.push([user, workspace]);
      return op(state.client);
    },
  ),
}));
import {
  requirePermission,
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  inviteMember,
  acceptInvitation,
  removeMember,
  changeMemberRole,
} from "@/lib/workspaces";
const ws = "11111111-1111-4111-8111-111111111111";
const input = {
  name: "Agency",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en" as const,
  retentionDays: 90 as const,
};
function script(handlers: Handler[]) {
  const fake = fakeClient(handlers);
  state.client = fake.client;
  return fake;
}
beforeEach(() => {
  state.actors = [];
});
describe("requirePermission", () => {
  it("hides workspaces the actor does not belong to (404)", async () => {
    const { client } = script([role(null)]);
    await expect(
      requirePermission(client as never, ws, "workspace:read"),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("denies a member an administrative permission (403) and returns the live role", async () => {
    const { client } = script([role("member")]);
    await expect(
      requirePermission(client as never, ws, "workspace:update"),
    ).rejects.toMatchObject({ status: 403 });
    expect(await requirePermission(client as never, ws, "workspace:read")).toBe(
      "member",
    );
  });
});
describe("workspace services", () => {
  it("lists and creates workspaces without an active workspace context", async () => {
    const { calls } = script([
      ["FROM app.workspace w JOIN", [{ id: ws }]],
      ["app.create_workspace", [{ id: ws }]],
    ]);
    expect(await listWorkspaces("u1")).toEqual([{ id: ws }]);
    expect(await createWorkspace("u1", input)).toBe(ws);
    expect(state.actors).toEqual([
      ["u1", null],
      ["u1", null],
    ]);
    expect(calls[0].params).toEqual(["u1"]);
    expect(calls[1].params).toEqual([
      "Agency",
      "Digital agency",
      "UTC",
      "en",
      90,
    ]);
  });
  it("shows pending invitations only to roles that may invite", async () => {
    const member = script([
      role("member"),
      ["FROM app.workspace WHERE", [{ id: ws, name: "Agency" }]],
      ["app.member_directory", [{ user_id: "u1" }]],
    ]);
    const view = await getWorkspace("u1", ws);
    expect(view.invitations).toEqual([]);
    expect(view.workspace.role).toBe("member");
    expect(member.calls.some((c) => c.sql.includes("app.invitation"))).toBe(
      false,
    );
    script([
      role("admin"),
      ["FROM app.workspace WHERE", [{ id: ws }]],
      ["app.member_directory", []],
      ["FROM app.invitation", [{ id: "i1" }]],
    ]);
    expect((await getWorkspace("u2", ws)).invitations).toEqual([{ id: "i1" }]);
  });
  it("returns 404 when the workspace row is hidden even with a role", async () => {
    script([role("owner"), ["FROM app.workspace WHERE", []]]);
    await expect(getWorkspace("u1", ws)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("updating settings requires workspace:update before any write", async () => {
    const { calls } = script([role("member")]);
    await expect(updateWorkspace("u1", ws, input)).rejects.toMatchObject({
      status: 403,
    });
    expect(calls.some((c) => c.sql.includes("update_workspace"))).toBe(false);
  });
});
describe("invitations", () => {
  it("admins cannot invite admins; the SQL is never reached", async () => {
    const { calls } = script([role("admin")]);
    await expect(
      inviteMember("u1", ws, "a@b.example", "admin"),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.some((c) => c.sql.includes("invite_member"))).toBe(false);
  });
  it("sends only the SHA-256 hash to the database and returns the raw token once", async () => {
    const { calls } = script([
      role("owner"),
      ["app.invite_member", [{ id: "i1", expires_at: new Date() }]],
    ]);
    const result = await inviteMember("u1", ws, "a@b.example", "member");
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    const sent = calls.find((c) => c.sql.includes("invite_member"))!;
    expect(sent.params[3]).toBe(
      createHash("sha256").update(result.token).digest("hex"),
    );
    expect(JSON.stringify(calls)).not.toContain(result.token);
  });
  it("tokens are unique per invitation", async () => {
    script([
      role("owner"),
      ["app.invite_member", [{ id: "i1", expires_at: new Date() }]],
    ]);
    const a = await inviteMember("u1", ws, "a@b.example", "member");
    const b = await inviteMember("u1", ws, "a@b.example", "member");
    expect(a.token).not.toBe(b.token);
  });
  it("acceptance hashes the presented token and has no workspace context", async () => {
    const token = "ab".repeat(32);
    const { calls } = script([["app.accept_invitation", [{ id: ws }]]]);
    expect(await acceptInvitation("u1", token)).toBe(ws);
    expect(calls[0].params).toEqual([
      createHash("sha256").update(token).digest("hex"),
    ]);
    expect(state.actors).toEqual([["u1", null]]);
  });
});
describe("membership changes", () => {
  const target = (value: string | null) =>
    [
      "FROM app.workspace_membership WHERE",
      value ? [{ role: value }] : [],
    ] as Handler;
  it("removal: unknown member is 404; admins cannot remove admins; owner is protected", async () => {
    script([role("owner"), target(null)]);
    await expect(removeMember("u1", ws, "ghost")).rejects.toMatchObject({
      status: 404,
    });
    const admin = script([role("admin"), target("admin")]);
    await expect(removeMember("u1", ws, "u2")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("Only the owner can remove admins"),
    });
    expect(admin.calls.some((c) => c.sql.includes("remove_member"))).toBe(
      false,
    );
    script([role("admin"), target("owner")]);
    await expect(removeMember("u1", ws, "owner")).rejects.toMatchObject({
      status: 403,
      message: "The workspace owner cannot be removed.",
    });
    script([role("member"), target("member")]);
    await expect(removeMember("u1", ws, "u3")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("removal: permitted cases reach app.remove_member with the target", async () => {
    for (const [actor, targetRole, self] of [
      ["owner", "admin", false],
      ["admin", "member", false],
      ["member", "member", true],
    ] as const) {
      const { calls } = script([
        role(actor),
        target(targetRole),
        ["app.remove_member", []],
      ]);
      await removeMember("me", ws, self ? "me" : "them");
      expect(calls.at(-1)?.params).toEqual([ws, self ? "me" : "them"]);
    }
  });
  it("role changes require members:roles (owner only)", async () => {
    const { calls } = script([role("admin")]);
    await expect(
      changeMemberRole("u1", ws, "u2", "admin"),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.some((c) => c.sql.includes("change_member_role"))).toBe(false);
    const owner = script([role("owner"), ["app.change_member_role", []]]);
    await changeMemberRole("u1", ws, "u2", "admin");
    expect(owner.calls.at(-1)?.params).toEqual([ws, "u2", "admin"]);
  });
});
