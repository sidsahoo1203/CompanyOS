import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { asActor } from "./db";
import { AppError } from "./errors";
import {
  can,
  canInvite,
  canRemove,
  type Role,
  type Permission,
} from "./permissions";
import type { WorkspaceInput } from "./validation";
export type Workspace = {
  id: string;
  name: string;
  industry: string;
  timezone: string;
  language: "en";
  retention_days: 30 | 90 | 365;
  created_at: Date;
  updated_at: Date;
  role: Role;
};
export type Member = {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: Date;
};
export type Invite = {
  id: string;
  email: string;
  role: "admin" | "member";
  expires_at: Date;
};
export async function requirePermission(
  db: PoolClient,
  id: string,
  permission: Permission,
) {
  const role = (
    await db.query<{ role: Role }>("SELECT app.role_for($1) AS role", [id])
  ).rows[0]?.role;
  if (!role) throw new AppError(404, "Workspace not found.");
  if (!can(role, permission))
    throw new AppError(403, "You do not have permission for this action.");
  return role;
}
export function listWorkspaces(userId: string) {
  return asActor(
    userId,
    null,
    async (db) =>
      (
        await db.query<Workspace>(
          "SELECT w.*, m.role FROM app.workspace w JOIN app.workspace_membership m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
          [userId],
        )
      ).rows,
  );
}
export function createWorkspace(userId: string, input: WorkspaceInput) {
  return asActor(
    userId,
    null,
    async (db) =>
      (
        await db.query<{ id: string }>(
          "SELECT app.create_workspace($1,$2,$3,$4,$5) AS id",
          [
            input.name,
            input.industry,
            input.timezone,
            input.language,
            input.retentionDays,
          ],
        )
      ).rows[0].id,
  );
}
export function getWorkspace(userId: string, id: string) {
  return asActor(userId, id, async (db) => {
    const role = await requirePermission(db, id, "workspace:read");
    const workspace = (
      await db.query<Workspace>("SELECT * FROM app.workspace WHERE id=$1", [id])
    ).rows[0];
    if (!workspace) throw new AppError(404, "Workspace not found.");
    const members = (
      await db.query<Member>("SELECT * FROM app.member_directory($1)", [id])
    ).rows;
    const invitations = can(role, "members:invite")
      ? (
          await db.query<Invite>(
            "SELECT id,email,role,expires_at FROM app.invitation WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
            [id],
          )
        ).rows
      : [];
    return { workspace: { ...workspace, role }, members, invitations };
  });
}
export function updateWorkspace(
  userId: string,
  id: string,
  input: WorkspaceInput,
) {
  return asActor(userId, id, async (db) => {
    await requirePermission(db, id, "workspace:update");
    await db.query("SELECT app.update_workspace($1,$2,$3,$4,$5,$6)", [
      id,
      input.name,
      input.industry,
      input.timezone,
      input.language,
      input.retentionDays,
    ]);
  });
}
export function inviteMember(
  userId: string,
  id: string,
  email: string,
  targetRole: "admin" | "member",
) {
  return asActor(userId, id, async (db) => {
    const role = await requirePermission(db, id, "members:invite");
    if (!canInvite(role, targetRole))
      throw new AppError(403, "Only the owner can invite an administrator.");
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const result = await db.query<{ id: string; expires_at: Date }>(
      "SELECT * FROM app.invite_member($1,$2,$3,$4)",
      [id, email, targetRole, hash],
    );
    return { ...result.rows[0], token };
  });
}
export function acceptInvitation(userId: string, token: string) {
  return asActor(
    userId,
    null,
    async (db) =>
      (
        await db.query<{ id: string }>(
          "SELECT app.accept_invitation($1) AS id",
          [createHash("sha256").update(token).digest("hex")],
        )
      ).rows[0].id,
  );
}
export function removeMember(userId: string, id: string, memberId: string) {
  return asActor(userId, id, async (db) => {
    const role = await requirePermission(db, id, "workspace:read");
    const target = (
      await db.query<{ role: Role }>(
        "SELECT role FROM app.workspace_membership WHERE workspace_id=$1 AND user_id=$2",
        [id, memberId],
      )
    ).rows[0];
    if (!target) throw new AppError(404, "Member not found.");
    if (!canRemove(role, target.role, memberId === userId))
      throw new AppError(
        403,
        target.role === "owner"
          ? "The workspace owner cannot be removed."
          : "Only the owner can remove admins; admins can remove members.",
      );
    await db.query("SELECT app.remove_member($1,$2)", [id, memberId]);
  });
}
export function changeMemberRole(
  userId: string,
  id: string,
  memberId: string,
  role: "admin" | "member",
) {
  return asActor(userId, id, async (db) => {
    await requirePermission(db, id, "members:roles");
    await db.query("SELECT app.change_member_role($1,$2,$3)", [
      id,
      memberId,
      role,
    ]);
  });
}
