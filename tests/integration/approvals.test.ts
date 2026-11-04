import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Pool } from "pg";
import { asActor, authPool, tenantPool } from "@/lib/db";
import {
  createWorkspace,
  inviteMember,
  acceptInvitation,
} from "@/lib/workspaces";
import { saveSource, uploadDocument, processDocument } from "@/lib/knowledge";
import {
  publishProcedure,
  createSkill,
  toggleSkill,
  createRun,
  processRun,
  getRun,
} from "@/lib/agents";
import {
  requestApproval,
  listApprovals,
  getApproval,
  editApproval,
  decideApproval,
} from "@/lib/approvals";
const suffix = randomUUID();
const users = {
  owner: "po-" + suffix,
  admin: "pa-" + suffix,
  admin2: "pb-" + suffix,
  limited: "pl-" + suffix,
  member: "pm-" + suffix,
  other: "px-" + suffix,
};
const email = (id: string) => id + "@approvals.example";
const recipient = "client@example.test";
const workspaceInput = {
  name: "Approval test",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en" as const,
  retentionDays: 90 as const,
};
const sourceInput = {
  title: "Approval reference",
  description: "Synthetic",
  tags: [],
  scope: "workspace" as const,
  archived: false,
};
const migration = new Pool({
  connectionString: process.env.TEST_MIGRATION_DATABASE_URL,
});
let a: string, b: string, source: string, skill: string;
// Built from code points so no invisible characters are stored in this file.
const zeroWidth = String.fromCodePoint(0x200b);
async function draft(who: string, target = recipient) {
  const run = await createRun(who, a, {
    skillId: skill,
    requestKey: randomUUID(),
    input: {
      objective: "Prepare kickoff welcome",
      context: "Fictional approval context",
      target,
    },
  });
  await processRun(who, a, run);
  return run;
}
async function submitted(who: string, target = recipient) {
  const run = await draft(who, target);
  return {
    run,
    id: await requestApproval(who, a, { runId: run, proposalIndex: 0 }),
  };
}
const digestOf = async (who: string, id: string) =>
  (await getApproval(who, a, id)).request.digest;
const approve = (who: string, id: string, digest: string, key = randomUUID()) =>
  decideApproval(who, a, id, {
    decision: "approve",
    digest,
    idempotencyKey: key,
    confirmed: true,
  });
const reject = (who: string, id: string, digest: string) =>
  decideApproval(who, a, id, {
    decision: "reject",
    digest,
    idempotencyKey: randomUUID(),
    note: "Not appropriate",
  });
// Counts with the migration owner, bypassing RLS, so hidden executions cannot escape.
const executions = async (id: string) =>
  Number(
    (
      await migration.query(
        "SELECT count(*) FROM app.action_execution WHERE approval_id=$1",
        [id],
      )
    ).rows[0].count,
  );
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.pathname !== "/companyos_test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("Local isolated test DB required.");
  for (const [name, id] of Object.entries(users))
    await authPool().query(
      'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',
      [id, name, email(id)],
    );
  a = await createWorkspace(users.owner, workspaceInput);
  b = await createWorkspace(users.other, workspaceInput);
  for (const [who, role] of [
    [users.admin, "admin"],
    [users.admin2, "admin"],
    [users.limited, "admin"],
    [users.member, "member"],
  ] as const) {
    const invitation = await inviteMember(users.owner, a, email(who), role);
    await acceptInvitation(who, invitation.token);
  }
  source = await saveSource(users.owner, a, null, sourceInput);
  const doc = await uploadDocument(
    users.owner,
    a,
    source,
    "reference.txt",
    "",
    Buffer.from("Kickoff welcome messages confirm the brief and the scope."),
  );
  await processDocument(users.owner, a, doc);
  const version = await publishProcedure(users.owner, a, {
    procedureId: null,
    title: "Kickoff SOP",
    instructions: "Draft a welcome message for human review and approval.",
    sourceIds: [source],
  });
  skill = await createSkill(users.owner, a, {
    name: "Welcome message",
    versionId: version,
    operation: "message_draft",
    maxTokens: 8000,
    maxCostMicrousd: 0,
    timeoutMs: 1000,
  });
});
afterAll(async () => {
  await authPool().end();
  await tenantPool().end();
  await migration.end();
});
it("requests snapshot the exact target, content, inputs and sources; creation is idempotent", async () => {
  const { run, id } = await submitted(users.member);
  expect(
    await requestApproval(users.member, a, { runId: run, proposalIndex: 0 }),
  ).toBe(id);
  const proposal = (await getRun(users.member, a, run)).run.output!
    .proposals[0];
  const { request, viewer, checks } = await getApproval(users.member, a, id);
  expect(request).toMatchObject({
    kind: "send_message",
    target: recipient,
    payload: proposal.payload,
    status: "pending",
    revision: 1,
    inputs: {
      objective: "Prepare kickoff welcome",
      context: "Fictional approval context",
      target: recipient,
    },
  });
  expect(request.sources[0].quote).toContain("confirm the brief");
  expect(request.expected_effect).toContain(recipient);
  expect(request.expected_effect).toContain("local outbox");
  expect(request.expected_effect).toContain("Nothing is emailed");
  expect(request.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(viewer).toMatchObject({ canDecide: false, canEdit: true });
  expect(checks).toEqual({ recipientValid: true, contentSafe: true });
  // Only the run initiator can submit; other tenants cannot reference the run.
  await expect(
    requestApproval(users.owner, a, { runId: run, proposalIndex: 0 }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    requestApproval(users.other, b, { runId: run, proposalIndex: 0 }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    requestApproval(users.member, a, { runId: run, proposalIndex: 1 }),
  ).rejects.toMatchObject({ status: 404 });
});
it("approvers see readable requests, members only their own, foreign tenants nothing", async () => {
  const mine = await submitted(users.member);
  const theirs = await submitted(users.admin);
  const memberIds = (await listApprovals(users.member, a)).approvals.map(
    (item) => item.id,
  );
  expect(memberIds).toContain(mine.id);
  expect(memberIds).not.toContain(theirs.id);
  expect((await listApprovals(users.member, a)).canDecide).toBe(false);
  const ownerView = await listApprovals(users.owner, a);
  expect(ownerView.canDecide).toBe(true);
  expect(ownerView.approvals.map((item) => item.id)).toEqual(
    expect.arrayContaining([mine.id, theirs.id]),
  );
  await expect(getApproval(users.member, a, theirs.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(listApprovals(users.other, a)).rejects.toMatchObject({
    status: 404,
  });
  for (const table of ["approval_request", "action_execution"]) {
    const forged = await asActor(users.other, a, (db) =>
      db.query("SELECT * FROM app." + table),
    );
    expect(forged.rows).toEqual([]);
  }
});
it("members and foreign tenants cannot approve; refusals are audited and nothing executes", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.member, id);
  await expect(approve(users.member, id, digest)).rejects.toMatchObject({
    status: 403,
    outcome: "forbidden",
  });
  // The SQL gate refuses independently of the service layer.
  const direct = await asActor(users.member, a, (db) =>
    db.query("SELECT * FROM app.decide_approval($1,$2,'approve',$3,$4,'')", [
      a,
      id,
      digest,
      randomUUID(),
    ]),
  );
  expect(direct.rows[0]).toMatchObject({
    decision_outcome: "forbidden",
    decision_execution: null,
  });
  await expect(approve(users.other, id, digest)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    decideApproval(users.other, b, id, {
      decision: "approve",
      digest,
      idempotencyKey: randomUUID(),
      confirmed: true,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await executions(id)).toBe(0);
  const denied = await migration.query(
    "SELECT metadata->>'reason' AS reason,result,actor_id FROM app.audit_event WHERE workspace_id=$1 AND target=$2 AND action='approval.denied'",
    [a, id],
  );
  expect(denied.rows).toEqual(
    expect.arrayContaining([
      { reason: "forbidden", result: "denied", actor_id: users.member },
    ]),
  );
  expect((await getApproval(users.owner, a, id)).request.status).toBe(
    "pending",
  );
});
it("rejected requests can never be approved, edited or executed", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.admin, id);
  expect(await reject(users.admin, id, digest)).toMatchObject({
    outcome: "rejected",
    executionId: null,
  });
  await expect(approve(users.owner, id, digest)).rejects.toMatchObject({
    status: 409,
    outcome: "closed",
  });
  await expect(
    editApproval(users.member, a, id, {
      digest,
      target: recipient,
      payload: "Changed after rejection",
    }),
  ).rejects.toMatchObject({ outcome: "closed" });
  await expect(reject(users.owner, id, digest)).rejects.toMatchObject({
    outcome: "closed",
  });
  expect(await executions(id)).toBe(0);
  const { request } = await getApproval(users.member, a, id);
  expect(request).toMatchObject({
    status: "rejected",
    decision_note: "Not appropriate",
  });
});
it("edits create immutable revisions; only the exact reviewed revision can execute", async () => {
  const { id } = await submitted(users.member);
  const first = await digestOf(users.admin, id);
  const edited = await editApproval(users.admin, a, id, {
    digest: first,
    target: "Founder@Client.example ",
    payload: "Hello, welcome aboard. Your brief and scope are confirmed.",
  });
  expect(edited.id).not.toBe(id);
  const old = await getApproval(users.admin, a, id);
  expect(old.request.status).toBe("superseded");
  expect(old.viewer.canEdit).toBe(false);
  const next = await getApproval(users.admin, a, edited.id);
  expect(next.request).toMatchObject({
    revision: 2,
    supersedes: id,
    target: "Founder@Client.example",
    authored_by: users.admin,
    status: "pending",
  });
  expect(next.request.digest).not.toBe(first);
  expect(next.revisions.map((item) => item.status)).toEqual([
    "superseded",
    "pending",
  ]);
  // A superseded revision and a stale digest both fail closed.
  await expect(approve(users.owner, id, first)).rejects.toMatchObject({
    outcome: "closed",
  });
  await expect(approve(users.owner, edited.id, first)).rejects.toMatchObject({
    outcome: "stale",
  });
  await expect(
    editApproval(users.member, a, edited.id, {
      digest: first,
      target: recipient,
      payload: "Stale edit",
    }),
  ).rejects.toMatchObject({ outcome: "stale" });
  expect(await executions(id)).toBe(0);
  expect(await executions(edited.id)).toBe(0);
  const result = await approve(users.owner, edited.id, next.request.digest);
  expect(result.outcome).toBe("executed");
  const after = await getApproval(users.owner, a, edited.id);
  expect(after.request.status).toBe("executed");
  expect(after.execution).toMatchObject({
    id: result.executionId,
    executor: "local-outbox-v1",
    status: "recorded_locally",
    target: "Founder@Client.example",
    payload: "Hello, welcome aboard. Your brief and scope are confirmed.",
    digest: next.request.digest,
  });
  expect(await executions(edited.id)).toBe(1);
  expect(await executions(id)).toBe(0);
});
it("nobody approves content they wrote except the workspace owner", async () => {
  const adminRequest = await submitted(users.admin);
  const digest = await digestOf(users.admin, adminRequest.id);
  expect(
    (await getApproval(users.admin, a, adminRequest.id)).viewer.selfAuthored,
  ).toBe(true);
  await expect(
    approve(users.admin, adminRequest.id, digest),
  ).rejects.toMatchObject({ status: 403, outcome: "self_approval" });
  expect(await executions(adminRequest.id)).toBe(0);
  expect((await approve(users.admin2, adminRequest.id, digest)).outcome).toBe(
    "executed",
  );
  const ownerRequest = await submitted(users.owner);
  expect(
    (
      await approve(
        users.owner,
        ownerRequest.id,
        await digestOf(users.owner, ownerRequest.id),
      )
    ).outcome,
  ).toBe("executed");
});
it("replays return the original execution for the same key and are refused otherwise", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.owner, id);
  const key = randomUUID();
  const first = await approve(users.owner, id, digest, key);
  const again = await approve(users.owner, id, digest, key);
  expect(again).toEqual(first);
  await expect(approve(users.owner, id, digest)).rejects.toMatchObject({
    status: 409,
    outcome: "replay",
  });
  await expect(approve(users.admin2, id, digest, key)).rejects.toMatchObject({
    outcome: "replay",
  });
  await expect(reject(users.admin, id, digest)).rejects.toMatchObject({
    outcome: "replay",
  });
  // A key already used for another request cannot be reused.
  const second = await submitted(users.member);
  await expect(
    approve(
      users.owner,
      second.id,
      await digestOf(users.owner, second.id),
      key,
    ),
  ).rejects.toMatchObject({ outcome: "replay" });
  expect(await executions(id)).toBe(1);
  expect(await executions(second.id)).toBe(0);
});
it("concurrent approvals execute exactly once", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.owner, id);
  const results = await Promise.allSettled([
    approve(users.owner, id, digest),
    approve(users.admin, id, digest),
    approve(users.admin2, id, digest),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  for (const item of results)
    if (item.status === "rejected")
      expect(item.reason).toMatchObject({ outcome: "replay" });
  expect(await executions(id)).toBe(1);
});
it("expired requests cannot be approved; a revision requests a fresh decision", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.owner, id);
  await migration.query(
    "UPDATE app.approval_request SET expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await expect(approve(users.owner, id, digest)).rejects.toMatchObject({
    outcome: "expired",
  });
  expect(await executions(id)).toBe(0);
  const expired = await getApproval(users.member, a, id);
  expect(expired.request.status).toBe("expired");
  expect(expired.viewer.canEdit).toBe(true);
  const fresh = await editApproval(users.member, a, id, {
    digest,
    target: recipient,
    payload: "Refreshed welcome message after expiry.",
  });
  expect((await getApproval(users.member, a, id)).viewer.canEdit).toBe(false);
  expect(
    (
      await approve(
        users.owner,
        fresh.id,
        await digestOf(users.owner, fresh.id),
      )
    ).outcome,
  ).toBe("executed");
});
it("invalid recipients and hidden characters must be fixed before approval", async () => {
  // Without a run target the proposal carries a placeholder, not an address.
  const { id } = await submitted(users.member, "");
  const detail = await getApproval(users.owner, a, id);
  expect(detail.checks.recipientValid).toBe(false);
  await expect(
    approve(users.owner, id, detail.request.digest),
  ).rejects.toMatchObject({ status: 422, outcome: "invalid_target" });
  await expect(
    editApproval(users.member, a, id, {
      digest: detail.request.digest,
      target: "one@example.test, two@example.test",
      payload: "Two recipients",
    }),
  ).rejects.toMatchObject({ name: "ZodError" });
  await expect(
    editApproval(users.member, a, id, {
      digest: detail.request.digest,
      target: recipient,
      payload: "Pay" + zeroWidth + "now",
    }),
  ).rejects.toMatchObject({ name: "ZodError" });
  const direct = await asActor(users.member, a, (db) =>
    db.query("SELECT * FROM app.edit_approval($1,$2,$3,$4,$5)", [
      a,
      id,
      detail.request.digest,
      recipient,
      "Pay" + zeroWidth + "now",
    ]),
  );
  expect(direct.rows[0]).toMatchObject({
    edit_outcome: "unsafe_content",
    edit_id: null,
  });
  // Simulate a hidden character that arrived inside source-derived content.
  await migration.query(
    "UPDATE app.approval_request SET target=$2,payload=payload||$3,digest=app.approval_digest(id,revision,kind,$2,payload||$3,inputs,sources,expected_effect) WHERE id=$1",
    [id, recipient, zeroWidth],
  );
  const tainted = await getApproval(users.owner, a, id);
  expect(tainted.checks.contentSafe).toBe(false);
  await expect(
    approve(users.owner, id, tainted.request.digest),
  ).rejects.toMatchObject({ outcome: "unsafe_content" });
  expect(await executions(id)).toBe(0);
  const fixed = await editApproval(users.member, a, id, {
    digest: tainted.request.digest,
    target: recipient,
    payload: "Clean welcome message with ₹ pricing and emoji support.",
  });
  expect(
    (
      await approve(
        users.owner,
        fixed.id,
        await digestOf(users.owner, fixed.id),
      )
    ).outcome,
  ).toBe("executed");
});
it("disabled skills and revoked source access block decisions", async () => {
  const { id } = await submitted(users.member);
  const digest = await digestOf(users.owner, id);
  await toggleSkill(users.owner, a, skill, false);
  try {
    await expect(approve(users.owner, id, digest)).rejects.toMatchObject({
      outcome: "skill_disabled",
    });
  } finally {
    await toggleSkill(users.owner, a, skill, true);
  }
  await saveSource(users.owner, a, source, {
    ...sourceInput,
    scope: "private",
  });
  try {
    await expect(getApproval(users.admin, a, id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(approve(users.admin, id, digest)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getApproval(users.member, a, id)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    await saveSource(users.owner, a, source, sourceInput);
  }
  expect(await executions(id)).toBe(0);
});
it("the runtime role cannot write approvals, executions or audit events directly", async () => {
  const { id } = await submitted(users.member);
  for (const sql of [
    "UPDATE app.approval_request SET status='executed'",
    "INSERT INTO app.action_execution(workspace_id,approval_id,idempotency_key,digest,executor,kind,target,payload,executed_by) SELECT workspace_id,id,gen_random_uuid(),digest,'local-outbox-v1',kind,target,payload,requested_by FROM app.approval_request",
    "DELETE FROM app.audit_event",
  ]) {
    await expect(
      asActor(users.owner, a, (db) => db.query(sql)),
    ).rejects.toMatchObject({ code: "42501" });
  }
  expect(await executions(id)).toBe(0);
});
it("audit events cover every decision path without recipients or content", async () => {
  const events = await migration.query(
    "SELECT action,result,risk,target,metadata FROM app.audit_event WHERE workspace_id=$1 AND (action LIKE 'approval.%' OR action='action.executed')",
    [a],
  );
  expect(new Set(events.rows.map((row) => row.action))).toEqual(
    new Set([
      "approval.requested",
      "approval.edited",
      "approval.approved",
      "approval.rejected",
      "approval.expired",
      "approval.denied",
      "action.executed",
    ]),
  );
  const serialized = JSON.stringify(events.rows);
  for (const secret of [
    recipient,
    "Founder@Client.example",
    "welcome aboard",
    "Fictional approval context",
  ])
    expect(serialized).not.toContain(secret);
  expect(
    events.rows
      .filter((row) => row.action === "action.executed")
      .every((row) => row.risk === "high"),
  ).toBe(true);
});
it("decision attempts are limited per person per minute", async () => {
  const { id } = await submitted(users.member);
  const stale = "0".repeat(64);
  for (let attempt = 0; attempt < 30; attempt++)
    await expect(approve(users.limited, id, stale)).rejects.toMatchObject({
      outcome: "stale",
    });
  await expect(approve(users.limited, id, stale)).rejects.toMatchObject({
    status: 429,
    outcome: "rate_limited",
  });
  expect(await executions(id)).toBe(0);
});
