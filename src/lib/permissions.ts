export const roles = ["owner", "admin", "member"] as const;
export type Role = (typeof roles)[number];
export type Permission =
  | "workspace:read"
  | "workspace:update"
  | "members:invite"
  | "members:roles"
  | "approvals:decide";
const permissions: Record<Role, readonly Permission[]> = {
  owner: [
    "workspace:read",
    "workspace:update",
    "members:invite",
    "members:roles",
    "approvals:decide",
  ],
  admin: [
    "workspace:read",
    "workspace:update",
    "members:invite",
    "approvals:decide",
  ],
  member: ["workspace:read"],
};
export function can(role: Role, permission: Permission) {
  return permissions[role]?.includes(permission) ?? false;
}
export function canInvite(role: Role, targetRole: "admin" | "member") {
  return role === "owner" || (role === "admin" && targetRole === "member");
}
// Mirrors app.remove_member: anyone but the owner may leave; removal follows invitation rules.
export function canRemove(role: Role, targetRole: Role, self: boolean) {
  if (targetRole === "owner") return false;
  return (
    self ||
    (targetRole !== "admin" ? canInvite(role, "member") : role === "owner")
  );
}
