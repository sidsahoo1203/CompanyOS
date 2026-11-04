import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { authPool, tenantPool } from "@/lib/db";
import {
  createWorkspace,
  inviteMember,
  acceptInvitation,
  changeMemberRole,
  removeMember,
} from "@/lib/workspaces";
import {
  saveSource,
  uploadDocument,
  processDocument,
  getDocument,
} from "@/lib/knowledge";
import {
  publishProcedure,
  createSkill,
  createRun,
  processRun,
  getRun,
} from "@/lib/agents";
import {
  requestApproval,
  getApproval,
  listApprovals,
  editApproval,
  decideApproval,
} from "@/lib/approvals";
import { pdf } from "../fixtures/documents";
const suffix = randomUUID();
const users = {
  owner: "lo-" + suffix,
  admin: "la-" + suffix,
  admin2: "lb-" + suffix,
  member: "lm-" + suffix,
  leaver: "ll-" + suffix,
};
const email = (id: string) => id + "@lifecycle.example";
const migration = new Pool({
  connectionString: process.env.TEST_MIGRATION_DATABASE_URL,
});
const workspaceInput = {
  name: "Lifecycle",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en" as const,
  retentionDays: 90 as const,
};
const sourceInput = {
  title: "Kickoff guide",
  description: "",
  tags: [],
  scope: "workspace" as const,
  archived: false,
};
let ws: string, source: string, doc: string, skill: string;
const audit = async (target: string, action?: string) =>
  (
    await migration.query(
      "SELECT action FROM app.audit_event WHERE workspace_id=$1 AND target=$2" +
        (action ? " AND action=$3" : "") +
        " ORDER BY created_at,id",
      action ? [ws, target, action] : [ws, target],
    )
  ).rows.map((r) => r.action as string);
const executions = async (approval: string) =>
  Number(
    (
      await migration.query(
        "SELECT count(*) FROM app.action_execution WHERE approval_id=$1",
        [approval],
      )
    ).rows[0].count,
  );
async function draftAndRequest(who: string) {
  const run = await createRun(who, ws, {
    skillId: skill,
    requestKey: randomUUID(),
    input: {
      objective: "Welcome Northwind",
      context: "Fictional",
      target: "client@example.test",
    },
  });
  await processRun(who, ws, run);
  return {
    run,
    id: await requestApproval(who, ws, { runId: run, proposalIndex: 0 }),
  };
}
const digestOf = async (who: string, id: string) =>
  (await getApproval(who, ws, id)).request.digest;
const approve = async (who: string, id: string) =>
  decideApproval(who, ws, id, {
    decision: "approve",
    digest: await digestOf(who, id),
    idempotencyKey: randomUUID(),
    confirmed: true,
  });
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/companyos_test")
    throw new Error("Local isolated test DB required.");
  for (const [name, id] of Object.entries(users))
    await authPool().query(
      'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',
      [id, name, email(id)],
    );
  ws = await createWorkspace(users.owner, workspaceInput);
  for (const [who, role] of [
    [users.admin, "admin"],
    [users.admin2, "admin"],
    [users.member, "member"],
    [users.leaver, "member"],
  ] as const)
    await acceptInvitation(
      who,
      (await inviteMember(users.owner, ws, email(who), role)).token,
    );
  source = await saveSource(users.owner, ws, null, sourceInput);
  doc = await uploadDocument(
    users.owner,
    ws,
    source,
    "kickoff.pdf",
    "application/pdf",
    pdf("Kickoff meetings confirm the signed brief."),
  );
  expect((await processDocument(users.owner, ws, doc)).status).toBe("ready");
  skill = await createSkill(users.owner, ws, {
    name: "Welcome",
    versionId: await publishProcedure(users.owner, ws, {
      procedureId: null,
      title: "Welcome SOP",
      instructions: "Draft a welcome message for approval.",
      sourceIds: [source],
    }),
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
describe("end-to-end journey across roles", () => {
  it("PDF source → procedure → member run → admin edit → owner approval → one local execution, fully audited", async () => {
    const { run, id } = await draftAndRequest(users.member);
    expect(
      (await getRun(users.member, ws, run)).run.citations?.[0].quote,
    ).toContain("signed brief");
    const revision = await editApproval(users.admin, ws, id, {
      digest: await digestOf(users.admin, id),
      target: "founder@northwind.example",
      payload: "Welcome aboard. Your signed brief is confirmed.",
    });
    expect((await approve(users.owner, revision.id)).outcome).toBe("executed");
    const final = await getApproval(users.owner, ws, revision.id);
    expect(final.execution).toMatchObject({
      target: "founder@northwind.example",
      executor: "local-outbox-v1",
    });
    expect(await audit(id)).toEqual(["approval.requested"]);
    expect(await audit(revision.id)).toEqual([
      "approval.edited",
      "approval.approved",
    ]);
    expect(await audit(final.execution!.id)).toEqual(["action.executed"]);
    expect(await executions(id)).toBe(0);
  });
});
describe("live permissions", () => {
  it("a demoted admin loses the right to decide immediately, and regains it when promoted", async () => {
    const { id } = await draftAndRequest(users.member);
    const digest = await digestOf(users.owner, id);
    await changeMemberRole(users.owner, ws, users.admin2, "member");
    // As a member they cannot even see someone else's request, let alone decide it.
    await expect(getApproval(users.admin2, ws, id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      decideApproval(users.admin2, ws, id, {
        decision: "approve",
        digest,
        idempotencyKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await executions(id)).toBe(0);
    await changeMemberRole(users.owner, ws, users.admin2, "admin");
    expect((await approve(users.admin2, id)).outcome).toBe("executed");
  });
  it("a removed member's queued run cannot be processed or viewed", async () => {
    const run = await createRun(users.leaver, ws, {
      skillId: skill,
      requestKey: randomUUID(),
      input: { objective: "Draft", context: "", target: "" },
    });
    await removeMember(users.owner, ws, users.leaver);
    await expect(processRun(users.leaver, ws, run)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getRun(users.leaver, ws, run)).rejects.toMatchObject({
      status: 404,
    });
    const status = (
      await migration.query("SELECT status FROM app.agent_run WHERE id=$1", [
        run,
      ])
    ).rows[0].status;
    expect(status).toBe("queued");
  });
  it("an expired request from a removed person cannot be revived by editing", async () => {
    await acceptInvitation(
      users.leaver,
      (await inviteMember(users.owner, ws, email(users.leaver), "member"))
        .token,
    );
    const { id } = await draftAndRequest(users.leaver);
    const digest = await digestOf(users.owner, id);
    await removeMember(users.owner, ws, users.leaver);
    expect((await getApproval(users.owner, ws, id)).request.status).toBe(
      "expired",
    );
    await expect(
      editApproval(users.admin, ws, id, {
        digest,
        target: "client@example.test",
        payload: "Revived content",
      }),
    ).rejects.toMatchObject({ outcome: "closed" });
    expect((await getApproval(users.owner, ws, id)).viewer.canEdit).toBe(false);
    const revisions = await migration.query(
      "SELECT count(*) FROM app.approval_request WHERE supersedes=$1",
      [id],
    );
    expect(Number(revisions.rows[0].count)).toBe(0);
  });
});
describe("audit volume and expiry", () => {
  it("repeated document views are audited at most once per person per 10 minutes", async () => {
    for (let i = 0; i < 25; i++) await getDocument(users.member, ws, doc);
    await getDocument(users.admin, ws, doc);
    expect(await audit(doc, "document.accessed")).toHaveLength(2);
    await migration.query(
      "UPDATE app.audit_event SET created_at=created_at-interval '11 minutes' WHERE workspace_id=$1 AND target=$2 AND action='document.accessed'",
      [ws, doc],
    );
    await getDocument(users.member, ws, doc);
    expect(await audit(doc, "document.accessed")).toHaveLength(3);
  });
  it("overdue requests expire when the inbox is read, and the expiry is audited once", async () => {
    const { id } = await draftAndRequest(users.member);
    await migration.query(
      "UPDATE app.approval_request SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    for (let i = 0; i < 3; i++) await listApprovals(users.owner, ws);
    expect((await getApproval(users.owner, ws, id)).request.status).toBe(
      "expired",
    );
    expect(await audit(id, "approval.expired")).toHaveLength(1);
  });
});
describe("limits and concurrency", () => {
  it("concurrent uploads of the same filename become consecutive immutable versions", async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        uploadDocument(
          users.owner,
          ws,
          source,
          "notes.txt",
          "text/plain",
          Buffer.from("Version " + i),
        ),
      ),
    );
    const versions = (
      await migration.query(
        "SELECT version FROM app.document WHERE id = ANY($1) ORDER BY version",
        [ids],
      )
    ).rows.map((r) => r.version);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });
  it("a creator is limited to 10 workspaces; the 11th is refused as invalid input", async () => {
    const creator = "lw-" + randomUUID();
    await authPool().query(
      'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',
      [creator, "Creator", email(creator)],
    );
    for (let i = 0; i < 10; i++) await createWorkspace(creator, workspaceInput);
    await expect(
      createWorkspace(creator, workspaceInput),
    ).rejects.toMatchObject({ code: "22023" });
  });
  it("a workspace is limited to 50 sources", async () => {
    const limited = await createWorkspace(users.owner, workspaceInput);
    const results = await Promise.allSettled(
      Array.from({ length: 51 }, (_, i) =>
        saveSource(users.owner, limited, null, {
          ...sourceInput,
          title: "Source " + i,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(50);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.code),
    ).toEqual(["54000"]);
  });
});
