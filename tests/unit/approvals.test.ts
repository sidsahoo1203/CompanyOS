import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approvalOutcomes,
  decisionSchema,
  editApprovalSchema,
  recipientValid,
  textSafe,
  unsafeCharacters,
} from "@/lib/approval-contracts";
import { can } from "@/lib/permissions";
const digest = "a".repeat(64);
const approve = {
  decision: "approve",
  digest,
  idempotencyKey: randomUUID(),
  confirmed: true,
};
const hidden = [
  0x200b, 0x200f, 0x202e, 0x2066, 0x2069, 0x2060, 0xfeff, 0x7, 0x7f,
].map((point) => String.fromCodePoint(point));
describe("approval decisions", () => {
  it("require an explicit review confirmation, digest and idempotency key", () => {
    expect(decisionSchema.safeParse(approve).success).toBe(true);
    for (const value of [
      { ...approve, confirmed: false },
      { ...approve, confirmed: undefined },
      { ...approve, digest: "short" },
      { ...approve, idempotencyKey: "not-a-uuid" },
      { ...approve, decision: "execute" },
      { ...approve, note: "x".repeat(501) },
    ])
      expect(decisionSchema.safeParse(value).success).toBe(false);
    expect(
      decisionSchema.safeParse({
        decision: "reject",
        digest,
        idempotencyKey: randomUUID(),
      }).success,
    ).toBe(true);
  });
  it("never accept client-supplied authority, identity or execution fields", () => {
    for (const extra of [
      { executionAllowed: true },
      { approvedBy: "someone" },
      { role: "owner" },
      { target: "attacker@example.test" },
      { payload: "Different content" },
    ])
      expect(decisionSchema.safeParse({ ...approve, ...extra }).success).toBe(
        false,
      );
  });
  it("only owners and admins hold the decide permission", () => {
    expect(can("owner", "approvals:decide")).toBe(true);
    expect(can("admin", "approvals:decide")).toBe(true);
    expect(can("member", "approvals:decide")).toBe(false);
  });
  it("map every database refusal to a safe client error", () => {
    for (const outcome of [
      "forbidden",
      "self_approval",
      "stale",
      "closed",
      "replay",
      "expired",
      "skill_disabled",
      "invalid_target",
      "unsafe_content",
      "revision_limit",
      "unchanged",
      "rate_limited",
    ]) {
      const [status, message] = approvalOutcomes[outcome];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(message).not.toMatch(/sql|postgres|exception/i);
    }
  });
});
describe("edit before approval", () => {
  const edit = { digest, target: "client@example.test", payload: "Hello" };
  it("requires exactly one valid recipient email", () => {
    expect(editApprovalSchema.safeParse(edit).success).toBe(true);
    for (const target of [
      "",
      "Recipient must be selected by a human",
      "a@b",
      "one@example.test, two@example.test",
      "Name <one@example.test>",
      "one@example.test;two@example.test",
    ])
      expect(editApprovalSchema.safeParse({ ...edit, target }).success).toBe(
        false,
      );
  });
  it("rejects hidden, control and bidirectional characters but keeps real text", () => {
    for (const character of hidden) {
      expect(textSafe("pay" + character + "now")).toBe(false);
      expect(
        editApprovalSchema.safeParse({
          ...edit,
          payload: "pay" + character + "now",
        }).success,
      ).toBe(false);
    }
    const real =
      "Line one\nLine two\tTabbed " +
      String.fromCodePoint(0x20b9) +
      "500 " +
      String.fromCodePoint(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947) +
      " " +
      String.fromCodePoint(0x1f600);
    expect(textSafe(real)).toBe(true);
    expect(
      editApprovalSchema.safeParse({ ...edit, payload: real }).success,
    ).toBe(true);
    expect(
      editApprovalSchema.safeParse({ ...edit, payload: "   " }).success,
    ).toBe(false);
    expect(
      editApprovalSchema.safeParse({ ...edit, approved: true }).success,
    ).toBe(false);
  });
  it("matches the database character class exactly", () => {
    const sql = readFileSync("db/migrations/007_ascii_text_safety.sql", "utf8");
    const databaseClass = /E'(\[[^']+\])'/
      .exec(sql)?.[1]
      .replaceAll("\\\\", "\\");
    expect(databaseClass).toBe(unsafeCharacters.source);
    expect(recipientValid("a.b+c@sub.example.co")).toBe(true);
  });
});
