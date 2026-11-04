import "server-only";
import { asActor } from "./db";
import { requirePermission } from "./workspaces";
import { AppError } from "./errors";
import { can, type Role } from "./permissions";
import {
  approvalOutcomes,
  decisionSchema,
  editApprovalSchema,
  requestApprovalSchema,
  recipientValid,
  textSafe,
} from "./approval-contracts";
import type { Citation } from "./knowledge";
import type { RunInput } from "./agent-contracts";
export type ApprovalSummary = {
  id: string;
  run_id: string;
  proposal_index: number;
  revision: number;
  kind: "send_message";
  target: string;
  status: string;
  requested_by: string;
  requester_name: string | null;
  requester_email: string | null;
  requester_active: boolean | null;
  authored_by: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decider_name: string | null;
  decider_email: string | null;
};
export type ApprovalRequest = ApprovalSummary & {
  payload: string;
  inputs: RunInput;
  sources: Citation[];
  expected_effect: string;
  digest: string;
  supersedes: string | null;
  decision_note: string | null;
};
export type ApprovalRevision = {
  id: string;
  revision: number;
  status: string;
  created_at: string;
  author_name: string | null;
  author_email: string | null;
};
export type ActionExecution = {
  id: string;
  executor: string;
  kind: string;
  target: string;
  payload: string;
  digest: string;
  status: string;
  executed_at: string;
  executor_name: string | null;
  executor_email: string | null;
};
export type AuditEntry = {
  action: string;
  result: string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  reason: string | null;
};
export type ApprovalDetail = {
  request: ApprovalRequest;
  revisions: ApprovalRevision[];
  execution: ActionExecution | null;
  audit: AuditEntry[];
  viewer: {
    role: Role;
    canDecide: boolean;
    canEdit: boolean;
    selfAuthored: boolean;
  };
  checks: { recipientValid: boolean; contentSafe: boolean };
};
// Names are user-editable, so records always carry the immutable email too.
// Includes former members so offboarding never erases who acted.
const people =
  "WITH people AS (SELECT user_id,name,email,current_member FROM app.workspace_people($1)) ";
const summaryColumns =
  "a.id,a.run_id,a.proposal_index,a.revision,a.kind,a.target,a.status,a.requested_by,rq.name AS requester_name," +
  "rq.email AS requester_email,rq.current_member AS requester_active,a.authored_by,au.name AS author_name,au.email AS author_email,a.created_at," +
  "a.expires_at,a.decided_at,dc.name AS decider_name,dc.email AS decider_email";
const joins =
  " FROM app.approval_request a LEFT JOIN people rq ON rq.user_id=a.requested_by" +
  " LEFT JOIN people au ON au.user_id=a.authored_by LEFT JOIN people dc ON dc.user_id=a.decided_by";
function outcomeError(outcome: string) {
  const [status, message] = approvalOutcomes[outcome] ?? [
    409,
    "This approval action was refused.",
  ];
  return Object.assign(new AppError(status, message), { outcome });
}
async function approvalErrors<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "P0002")
      throw Object.assign(
        new AppError(
          404,
          "This approval request or run proposal is unavailable. It may be restricted, disabled or not ready.",
        ),
        { code },
      );
    if (code === "54000")
      throw Object.assign(
        new AppError(
          429,
          "Approval request limit reached. Wait a minute and try again.",
        ),
        { code },
      );
    // A concurrent duplicate idempotency key loses the unique-constraint race.
    if (code === "23505") throw outcomeError("replay");
    throw error;
  }
}
export function listApprovals(user: string, workspace: string) {
  return asActor(user, workspace, async (db) => {
    const role = await requirePermission(db, workspace, "workspace:read");
    await db.query("SELECT app.expire_approvals($1)", [workspace]);
    const approvals = (
      await db.query<ApprovalSummary>(
        people +
          "SELECT " +
          summaryColumns +
          joins +
          " WHERE a.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM app.approval_request n" +
          " WHERE n.run_id=a.run_id AND n.proposal_index=a.proposal_index AND n.revision>a.revision)" +
          " ORDER BY a.created_at DESC LIMIT 200",
        [workspace],
      )
    ).rows;
    return { approvals, canDecide: can(role, "approvals:decide") };
  });
}
export function requestApproval(
  user: string,
  workspace: string,
  value: unknown,
) {
  const input = requestApprovalSchema.parse(value);
  return approvalErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:read");
      return (
        await db.query<{ id: string }>(
          "SELECT app.request_approval($1,$2,$3) AS id",
          [workspace, input.runId, input.proposalIndex],
        )
      ).rows[0].id;
    }),
  );
}
export function getApproval(
  user: string,
  workspace: string,
  id: string,
): Promise<ApprovalDetail> {
  return asActor(user, workspace, async (db) => {
    const role = await requirePermission(db, workspace, "workspace:read");
    await db.query("SELECT app.expire_approvals($1)", [workspace]);
    const request = (
      await db.query<ApprovalRequest>(
        people +
          "SELECT " +
          summaryColumns +
          ",a.payload,a.inputs,a.sources,a.expected_effect,a.digest,a.supersedes,a.decision_note" +
          joins +
          " WHERE a.workspace_id=$1 AND a.id=$2",
        [workspace, id],
      )
    ).rows[0];
    if (!request)
      throw new AppError(
        404,
        "Approval request not found or its sources are no longer accessible.",
      );
    const revisions = (
      await db.query<ApprovalRevision>(
        people +
          "SELECT a.id,a.revision,a.status,a.created_at,au.name AS author_name,au.email AS author_email FROM app.approval_request a" +
          " LEFT JOIN people au ON au.user_id=a.authored_by" +
          " WHERE a.workspace_id=$1 AND a.run_id=$2 AND a.proposal_index=$3 ORDER BY a.revision",
        [workspace, request.run_id, request.proposal_index],
      )
    ).rows;
    const execution =
      (
        await db.query<ActionExecution>(
          people +
            "SELECT e.id,e.executor,e.kind,e.target,e.payload,e.digest,e.status,e.executed_at,p.name AS executor_name,p.email AS executor_email" +
            " FROM app.action_execution e LEFT JOIN people p ON p.user_id=e.executed_by" +
            " WHERE e.workspace_id=$1 AND e.approval_id=$2",
          [workspace, id],
        )
      ).rows[0] ?? null;
    const decide = can(role, "approvals:decide");
    const audit = decide
      ? (
          await db.query<AuditEntry>(
            people +
              "SELECT ev.action,ev.result,ev.created_at,p.name AS actor_name,p.email AS actor_email,ev.metadata->>'reason' AS reason" +
              " FROM app.audit_event ev LEFT JOIN people p ON p.user_id=ev.actor_id" +
              " WHERE ev.workspace_id=$1 AND ev.target=ANY($2::text[]) ORDER BY ev.created_at,ev.id",
            [
              workspace,
              [
                ...revisions.map((item) => item.id),
                ...(execution ? [execution.id] : []),
              ],
            ],
          )
        ).rows
      : [];
    const latest = revisions.at(-1)?.id === id;
    return {
      request,
      revisions,
      execution,
      audit,
      viewer: {
        role,
        canDecide: decide && request.status === "pending",
        canEdit:
          (request.requested_by === user || decide) &&
          // Requests from people who left the workspace stay closed.
          request.requester_active === true &&
          latest &&
          ["pending", "expired"].includes(request.status),
        selfAuthored: request.authored_by === user && role !== "owner",
      },
      checks: {
        recipientValid: recipientValid(request.target),
        contentSafe: textSafe(request.target) && textSafe(request.payload),
      },
    };
  });
}
export async function editApproval(
  user: string,
  workspace: string,
  id: string,
  value: unknown,
) {
  const input = editApprovalSchema.parse(value);
  // Commit first so refused edits remain in the audit log, then report the refusal.
  const row = await approvalErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:read");
      return (
        await db.query<{ edit_outcome: string; edit_id: string | null }>(
          "SELECT * FROM app.edit_approval($1,$2,$3,$4,$5)",
          [workspace, id, input.digest, input.target, input.payload],
        )
      ).rows[0];
    }),
  );
  if (row.edit_outcome !== "edited" || !row.edit_id)
    throw outcomeError(row.edit_outcome);
  return { id: row.edit_id };
}
export async function decideApproval(
  user: string,
  workspace: string,
  id: string,
  value: unknown,
) {
  const input = decisionSchema.parse(value);
  const row = await approvalErrors(
    asActor(user, workspace, async (db) => {
      const role = await requirePermission(db, workspace, "workspace:read");
      const result = (
        await db.query<{
          decision_outcome: string;
          decision_execution: string | null;
        }>("SELECT * FROM app.decide_approval($1,$2,$3,$4,$5,$6)", [
          workspace,
          id,
          input.decision,
          input.digest,
          input.idempotencyKey,
          input.note,
        ])
      ).rows[0];
      if (result.decision_outcome === "executed") {
        // Independent application gate: throwing here rolls the execution back.
        const executed = (
          await db.query<{ digest: string }>(
            "SELECT digest FROM app.action_execution WHERE workspace_id=$1 AND id=$2",
            [workspace, result.decision_execution],
          )
        ).rows[0];
        if (
          !can(role, "approvals:decide") ||
          input.decision !== "approve" ||
          executed?.digest !== input.digest
        )
          throw new AppError(403, "Execution was refused by policy.");
      }
      return result;
    }),
  );
  if (!["executed", "rejected"].includes(row.decision_outcome))
    throw outcomeError(row.decision_outcome);
  return {
    outcome: row.decision_outcome as "executed" | "rejected",
    executionId: row.decision_execution,
  };
}
