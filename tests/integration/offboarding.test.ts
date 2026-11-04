import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Pool } from "pg";
import { asActor, authPool, tenantPool } from "@/lib/db";
import {
  createWorkspace,
  inviteMember,
  acceptInvitation,
  getWorkspace,
  listWorkspaces,
  removeMember,
} from "@/lib/workspaces";
import {
  saveSource,
  uploadDocument,
  processDocument,
  listKnowledge,
  retrieve,
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
  decideApproval,
} from "@/lib/approvals";
const suffix = randomUUID();
const users = {
  owner: "oo-" + suffix,
  admin: "oa-" + suffix,
  admin2: "ob-" + suffix,
  member: "om-" + suffix,
  invitee: "oi-" + suffix,
};
const email = (id: string) => id + "@offboarding.example";
const migration = new Pool({
  connectionString: process.env.TEST_MIGRATION_DATABASE_URL,
});
let a: string, skill: string;
async function join(who: string, role: "admin" | "member") {
  const invitation = await inviteMember(users.owner, a, email(who), role);
  await acceptInvitation(who, invitation.token);
}
async function submitted(who: string) {
  const run = await createRun(who, a, {
    skillId: skill,
    requestKey: randomUUID(),
    input: { objective: "Welcome", context: "", target: "client@example.test" },
  });
  await processRun(who, a, run);
  return {
    run,
    id: await requestApproval(who, a, { runId: run, proposalIndex: 0 }),
  };
}
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
  a = await createWorkspace(users.owner, {
    name: "Offboarding test",
    industry: "Digital agency",
    timezone: "UTC",
    language: "en",
    retentionDays: 90,
  });
  await join(users.admin, "admin");
  await join(users.admin2, "admin");
  await join(users.member, "member");
  const source = await saveSource(users.owner, a, null, {
    title: "Offboarding reference",
    description: "",
    tags: [],
    scope: "workspace",
    archived: false,
  });
  const doc = await uploadDocument(
    users.owner,
    a,
    source,
    "reference.txt",
    "",
    Buffer.from("Kickoff welcome messages confirm the agreed scope."),
  );
  await processDocument(users.owner, a, doc);
  skill = await createSkill(users.owner, a, {
    name: "Welcome",
    versionId: await publishProcedure(users.owner, a, {
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
it("members cannot remove anyone; admins remove members only; nobody removes the owner", async () => {
  await expect(
    removeMember(users.member, a, users.admin),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    removeMember(users.admin, a, users.admin2),
  ).rejects.toMatchObject({ status: 403 });
  await expect(removeMember(users.admin, a, users.owner)).rejects.toMatchObject(
    { status: 403 },
  );
  await expect(removeMember(users.owner, a, users.owner)).rejects.toMatchObject(
    { status: 403 },
  );
  // The SQL function refuses independently of the service layer.
  for (const [who, target] of [
    [users.member, users.admin],
    [users.admin, users.admin2],
    [users.admin, users.owner],
    [users.owner, users.owner],
  ])
    await expect(
      asActor(who, a, (db) =>
        db.query("SELECT app.remove_member($1,$2)", [a, target]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  expect(
    (await getWorkspace(users.owner, a)).members.map((m) => m.user_id).sort(),
  ).toEqual([users.owner, users.admin, users.admin2, users.member].sort());
});
it("removal takes effect on the next request across every surface", async () => {
  const { run } = await submitted(users.member);
  expect((await listKnowledge(users.member, a)).sources).toHaveLength(1);
  await removeMember(users.admin, a, users.member);
  for (const attempt of [
    () => getWorkspace(users.member, a),
    () => listKnowledge(users.member, a),
    () => retrieve(users.member, a, "kickoff welcome"),
    () => listApprovals(users.member, a),
    () => getRun(users.member, a, run),
  ])
    await expect(attempt()).rejects.toMatchObject({ status: 404 });
  expect(
    (await listWorkspaces(users.member)).map((item) => item.id),
  ).not.toContain(a);
  for (const table of ["knowledge_source", "document_chunk", "agent_run"]) {
    const forged = await asActor(users.member, a, (db) =>
      db.query(
        table === "agent_run"
          ? "SELECT id FROM app.agent_run"
          : "SELECT * FROM app." + table,
      ),
    );
    expect(forged.rows).toEqual([]);
  }
  await expect(
    removeMember(users.owner, a, users.member),
  ).rejects.toMatchObject({ status: 404 });
});
it("pending approvals they requested expire and invitation links they issued stop working", async () => {
  const { id } = await submitted(users.admin);
  const digest = (await getApproval(users.owner, a, id)).request.digest;
  const invitation = await inviteMember(
    users.admin,
    a,
    email(users.invitee),
    "member",
  );
  await removeMember(users.owner, a, users.admin);
  const after = await getApproval(users.owner, a, id);
  expect(after.request.status).toBe("expired");
  expect(after.viewer.canDecide).toBe(false);
  await expect(
    decideApproval(users.admin2, a, id, {
      decision: "approve",
      digest,
      idempotencyKey: randomUUID(),
      confirmed: true,
    }),
  ).rejects.toMatchObject({ outcome: "expired" });
  expect(
    Number(
      (
        await migration.query(
          "SELECT count(*) FROM app.action_execution WHERE approval_id=$1",
          [id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);
  const expiry = await migration.query(
    "SELECT metadata->>'reason' AS reason FROM app.audit_event WHERE workspace_id=$1 AND target=$2 AND action='approval.expired'",
    [a, id],
  );
  expect(expiry.rows).toEqual([{ reason: "member_removed" }]);
  await expect(
    acceptInvitation(users.invitee, invitation.token),
  ).rejects.toMatchObject({ code: "P0002" });
});
it("records keep the verified email of former members, even after a display-name change", async () => {
  const { id } = await submitted(users.admin2);
  await authPool().query('UPDATE public."user" SET name=$2 WHERE id=$1', [
    users.admin2,
    "oo-" + suffix,
  ]);
  await removeMember(users.owner, a, users.admin2);
  const { request, audit } = await getApproval(users.owner, a, id);
  expect(request).toMatchObject({
    requester_name: "oo-" + suffix,
    requester_email: email(users.admin2),
    author_email: email(users.admin2),
  });
  expect(
    audit.find((entry) => entry.action === "approval.requested"),
  ).toMatchObject({ actor_email: email(users.admin2) });
  const listed = (await listApprovals(users.owner, a)).approvals.find(
    (item) => item.id === id,
  );
  expect(listed?.requester_email).toBe(email(users.admin2));
});
it("anyone but the owner can leave, re-invitation restores access, and removals are audited minimally", async () => {
  await join(users.member, "member");
  expect((await listKnowledge(users.member, a)).sources).toHaveLength(1);
  await removeMember(users.member, a, users.member);
  await expect(getWorkspace(users.member, a)).rejects.toMatchObject({
    status: 404,
  });
  const events = await migration.query(
    "SELECT actor_id,target,metadata FROM app.audit_event WHERE workspace_id=$1 AND action='member.removed' ORDER BY created_at",
    [a],
  );
  expect(events.rows.map((row) => row.metadata)).toEqual([
    { previousRole: "member", self: false },
    { previousRole: "admin", self: false },
    { previousRole: "admin", self: false },
    { previousRole: "member", self: true },
  ]);
  expect(events.rows.at(-1)).toMatchObject({
    actor_id: users.member,
    target: users.member,
  });
});
