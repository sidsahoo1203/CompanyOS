import { describe, expect, it } from "vitest";
import { can, canInvite, type Role } from "@/lib/permissions";
import {
  workspaceSchema,
  roleChangeSchema,
  inviteSchema,
  acceptSchema,
} from "@/lib/validation";
import { publicError } from "@/lib/errors";
import { body } from "@/lib/http";
describe("role policy", () => {
  it("gives members read access without administrative permissions", () => {
    expect(can("member", "workspace:read")).toBe(true);
    expect(can("member", "workspace:update")).toBe(false);
    expect(can("member", "members:invite")).toBe(false);
    expect(can("member", "members:roles")).toBe(false);
  });
  it("allows admins to invite members but not grant admin access", () => {
    expect(can("admin", "workspace:update")).toBe(true);
    expect(canInvite("admin", "member")).toBe(true);
    expect(canInvite("admin", "admin")).toBe(false);
    expect(can("admin", "members:roles")).toBe(false);
  });
  it("reserves role management to the owner and denies unknown roles", () => {
    expect(can("owner", "members:roles")).toBe(true);
    expect(canInvite("owner", "admin")).toBe(true);
    expect(can("invalid" as Role, "workspace:update")).toBe(false);
  });
});
describe("boundary validation", () => {
  const input = {
    name: "Agency",
    industry: "Digital agency",
    timezone: "UTC",
    language: "en",
    retentionDays: 90,
  };
  it("accepts valid settings and rejects invented fields or bad time zones", () => {
    expect(workspaceSchema.safeParse(input).success).toBe(true);
    expect(workspaceSchema.safeParse({ ...input, role: "owner" }).success).toBe(
      false,
    );
    expect(
      workspaceSchema.safeParse({ ...input, timezone: "../../secret" }).success,
    ).toBe(false);
    expect(
      workspaceSchema.safeParse({ ...input, retentionDays: 0 }).success,
    ).toBe(false);
  });
  it("never permits owner escalation through role or invite payloads", () => {
    expect(
      roleChangeSchema.safeParse({ userId: "abc", role: "owner" }).success,
    ).toBe(false);
    expect(
      inviteSchema.safeParse({ email: "test@example.com", role: "owner" })
        .success,
    ).toBe(false);
  });
  it("normalizes invitation emails and rejects malformed tokens", () => {
    expect(
      inviteSchema.parse({ email: "TEST@example.com", role: "member" }).email,
    ).toBe("test@example.com");
    expect(acceptSchema.safeParse({ token: "guess" }).success).toBe(false);
  });
  it("does not disclose exception details", () => {
    const error = new Error("password=secret; postgresql://private");
    expect(publicError(error)).toEqual({
      status: 503,
      message: expect.not.stringContaining("secret"),
    });
  });
  it("rejects malformed JSON and oversized streamed bodies", async () => {
    await expect(
      body(
        new Request("http://localhost", { method: "POST", body: "{" }),
        workspaceSchema,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      body(
        new Request("http://localhost", {
          method: "POST",
          body: "a".repeat(17000),
        }),
        workspaceSchema,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
