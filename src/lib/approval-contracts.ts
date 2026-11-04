import { z } from "zod";
// Mirrors app.approval_text_safe: control, zero-width and bidirectional characters can disguise content.
export const unsafeCharacters =
  // eslint-disable-next-line no-control-regex
  /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
// Mirrors app.approval_target_valid.
const recipientPattern =
  /^[^@\s<>(),;:"[\]]+@[^@\s<>(),;:"[\]]+\.[A-Za-z]{2,}$/;
export function textSafe(value: string) {
  return !unsafeCharacters.test(value);
}
export function recipientValid(value: string) {
  return value.length <= 254 && recipientPattern.test(value);
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const requestApprovalSchema = z
  .object({ runId: z.uuid(), proposalIndex: z.number().int().min(0).max(2) })
  .strict();
export const editApprovalSchema = z
  .object({
    digest,
    target: z
      .string()
      .trim()
      .max(254)
      .refine(recipientValid, "Enter one recipient email address.")
      .refine(textSafe, "Remove hidden or control characters."),
    payload: z
      .string()
      .min(1)
      .max(6000)
      .refine(textSafe, "Remove hidden or control characters.")
      .refine((value) => value.trim().length > 0, "Enter the message content."),
  })
  .strict();
export const decisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("approve"),
      digest,
      idempotencyKey: z.uuid(),
      // The reviewer must explicitly confirm they inspected the exact action.
      confirmed: z.literal(true),
      note: z.string().trim().max(500).default(""),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      digest,
      idempotencyKey: z.uuid(),
      note: z.string().trim().max(500).default(""),
    })
    .strict(),
]);
export type DecisionInput = z.infer<typeof decisionSchema>;
export type EditApprovalInput = z.infer<typeof editApprovalSchema>;
export const approvalOutcomes: Record<string, [number, string]> = {
  forbidden: [403, "Only owners and admins can decide approval requests."],
  self_approval: [
    403,
    "Someone else must approve content you wrote. Ask another admin or the workspace owner.",
  ],
  stale: [
    409,
    "This request changed since you opened it. Review the latest content before deciding.",
  ],
  closed: [
    409,
    "This request is no longer pending. Rejected, superseded and executed requests cannot change.",
  ],
  replay: [
    409,
    "This action was already decided. Replays and duplicate executions are blocked.",
  ],
  expired: [
    409,
    "This request expired. Save a revision to request a fresh decision.",
  ],
  skill_disabled: [
    409,
    "The skill behind this request is disabled, so it cannot be approved or edited.",
  ],
  invalid_target: [
    422,
    "Set one valid recipient email address before approving. Edit the request to create a new revision.",
  ],
  unsafe_content: [
    422,
    "The recipient or content contains hidden or control characters. Edit the request before approving.",
  ],
  revision_limit: [409, "This request reached its 20-revision limit."],
  unchanged: [400, "Change the recipient or content to save a revision."],
  rate_limited: [
    429,
    "Too many approval actions in the last minute. Wait a minute and try again.",
  ],
};
export const statusLabels: Record<string, string> = {
  pending: "Waiting for decision",
  rejected: "Rejected",
  superseded: "Superseded by a newer revision",
  expired: "Expired",
  executed: "Approved · recorded in local outbox",
};
// Display names can be changed by their owner; the email cannot, so always show both.
export function personLabel(name: string | null, email: string | null) {
  if (!email) return "an unknown user";
  return name ? name + " (" + email + ")" : email;
}
