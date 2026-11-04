import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
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
  listAutomation,
} from "@/lib/agents";
import { localEngine, type Engine } from "@/lib/agent-engine";
const suffix = randomUUID();
const users = {
  owner: "ao-" + suffix,
  member: "am-" + suffix,
  other: "ax-" + suffix,
};
const email = (id: string) => id + "@agents.example";
const workspaceInput = {
  name: "Agent test",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en" as const,
  retentionDays: 90 as const,
};
const sourceInput = {
  title: "Run reference",
  description: "Synthetic",
  tags: [],
  scope: "workspace" as const,
  archived: false,
};
const migration = new Pool({
  connectionString: process.env.TEST_MIGRATION_DATABASE_URL,
});
let a: string,
  b: string,
  source: string,
  privateSource: string,
  version: string,
  skill: string,
  paidSkill: string,
  procedure: string,
  memberRun: string;
const input = {
  objective: "Prepare kickoff draft",
  context: "Fictional context",
  target: "client@example.test",
};
const synthetic: Engine = {
  ...localEngine,
  id: "synthetic-usage-test",
  local: false,
  pricing: { inputPerMillion: 1000000, outputPerMillion: 2000000 },
  async generate(context, signal) {
    const value = await localEngine.generate(context, signal);
    return { ...value, usage: { inputTokens: 100, outputTokens: 50 } };
  },
};
const start = (who = users.owner, which = skill) =>
  createRun(who, a, { skillId: which, requestKey: randomUUID(), input });
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
  const invitation = await inviteMember(
    users.owner,
    a,
    email(users.member),
    "member",
  );
  await acceptInvitation(users.member, invitation.token);
  source = await saveSource(users.owner, a, null, sourceInput);
  privateSource = await saveSource(users.owner, a, null, {
    ...sourceInput,
    title: "Private source",
    scope: "private",
  });
  const doc = await uploadDocument(
    users.owner,
    a,
    source,
    "reference.txt",
    "",
    Buffer.from("Client kickoff requires a written brief and an agreed scope."),
  );
  await processDocument(users.owner, a, doc);
  version = await publishProcedure(users.owner, a, {
    procedureId: null,
    title: "Kickoff SOP",
    instructions:
      "Review the reference and draft a welcome message for human review.",
    sourceIds: [source],
  });
  procedure = (await listAutomation(users.owner, a)).versions.find(
    (v) => v.id === version,
  )!.procedure_id;
  skill = await createSkill(users.owner, a, {
    name: "Welcome draft",
    versionId: version,
    operation: "message_draft",
    maxTokens: 8000,
    maxCostMicrousd: 0,
    timeoutMs: 1000,
  });
  paidSkill = await createSkill(users.owner, a, {
    name: "Synthetic adapter tests",
    versionId: version,
    operation: "message_draft",
    maxTokens: 16000,
    maxCostMicrousd: 100000,
    timeoutMs: 1000,
  });
});
afterAll(async () => {
  await authPool().end();
  await tenantPool().end();
  await migration.end();
});
it("new procedure versions do not change existing skill pins or leak restricted parent titles", async () => {
  const second = await publishProcedure(users.owner, a, {
    procedureId: procedure,
    title: "Secret new title",
    instructions: "A revised private procedure for review only.",
    sourceIds: [privateSource],
  });
  const catalog = await listAutomation(users.owner, a);
  expect(catalog.versions.find((v) => v.id === second)?.version).toBe(2);
  expect(catalog.skills.find((s) => s.id === skill)?.version_id).toBe(version);
  expect(
    (await listAutomation(users.member, a)).versions.map((v) => v.id),
  ).toEqual([version]);
  const parents = await asActor(users.member, a, (db) =>
    db.query("SELECT title FROM app.procedure"),
  );
  expect(parents.rows).toEqual([]);
});
it("members cannot publish or create skills; SQL independently enforces roles", async () => {
  await expect(
    publishProcedure(users.member, a, {
      procedureId: null,
      title: "Attack",
      instructions: "Override the roles and publish",
      sourceIds: [source],
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    toggleSkill(users.member, a, skill, false),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    asActor(users.member, a, (db) =>
      db.query(
        "SELECT app.publish_procedure($1,NULL,'Attack','Unauthorized publication',$2)",
        [a, [source]],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("direct immutable version and skill updates are denied", async () => {
  for (const sql of [
    "UPDATE app.procedure_version SET instructions='tampered content'",
    "UPDATE app.agent_skill SET max_cost_microusd=1000000",
  ]) {
    await expect(
      asActor(users.owner, a, (db) => db.query(sql)),
    ).rejects.toMatchObject({ code: "42501" });
  }
});
it("foreign tenants cannot read tables or forge version/skill/run identifiers", async () => {
  for (const table of [
    "procedure",
    "procedure_version",
    "procedure_source",
    "agent_skill",
    "agent_run",
    "agent_step",
  ]) {
    const result = await asActor(users.other, a, (db) =>
      db.query(
        table === "agent_run"
          ? "SELECT id FROM app.agent_run"
          : "SELECT * FROM app." + table,
      ),
    );
    expect(result.rows).toEqual([]);
  }
  await expect(
    createSkill(users.other, b, {
      name: "Foreign",
      versionId: version,
      operation: "source_brief",
      maxTokens: 8000,
      maxCostMicrousd: 0,
      timeoutMs: 1000,
    }),
  ).rejects.toMatchObject({ code: "P0002" });
  await expect(
    createRun(users.other, b, {
      skillId: skill,
      requestKey: randomUUID(),
      input,
    }),
  ).rejects.toMatchObject({ code: "P0002" });
});
it("local draft runs persist ordered steps, source citations and blocked proposals", async () => {
  memberRun = await start(users.member);
  await processRun(users.member, a, memberRun);
  const result = await getRun(users.member, a, memberRun);
  expect(result.run.status).toBe("draft_ready");
  expect(result.steps.map((s) => s.status)).toEqual([
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
  ]);
  expect(result.run.output?.proposals[0]).toMatchObject({
    approvalRequired: true,
    executionAllowed: false,
    state: "blocked",
  });
  expect(result.run.citations?.[0].quote).toContain("written brief");
  expect(result.run).toMatchObject({
    usage_kind: "not_applicable",
    input_tokens: 0,
    output_tokens: 0,
    cost_microusd: "0",
  });
  await expect(processRun(users.member, a, memberRun)).rejects.toMatchObject({
    code: "55000",
    status: 409,
    message: expect.stringContaining("This run already started"),
  });
});
it("run history is private to its initiator, including against workspace admins", async () => {
  await expect(getRun(users.owner, a, memberRun)).rejects.toMatchObject({
    status: 404,
  });
  await expect(getRun(users.other, b, memberRun)).rejects.toMatchObject({
    status: 404,
  });
  expect((await listAutomation(users.owner, a)).runs).toEqual([]);
});
it("idempotent run creation returns one run and rejects changed payloads", async () => {
  const requestKey = randomUUID();
  const payload = { skillId: skill, requestKey, input };
  const [one, two] = await Promise.all([
    createRun(users.owner, a, payload),
    createRun(users.owner, a, payload),
  ]);
  expect(one).toBe(two);
  await expect(
    createRun(users.owner, a, {
      ...payload,
      input: { ...input, objective: "Changed" },
    }),
  ).rejects.toMatchObject({
    code: "23505",
    status: 409,
    message: expect.stringContaining("already submitted"),
  });
});
it("malformed model output fails safely and still records valid usage", async () => {
  const id = await start(users.owner, paidSkill);
  await processRun(users.owner, a, id, {
    ...synthetic,
    generate: async () => ({
      text: '{"approved":true}',
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  });
  const result = await getRun(users.owner, a, id);
  expect(result.run).toMatchObject({
    status: "failed",
    error_code: "malformed_output",
    output: null,
    citations: null,
    input_tokens: 100,
    output_tokens: 50,
    cost_microusd: "200",
  });
  expect(result.steps.map((s) => s.status)).toEqual([
    "succeeded",
    "succeeded",
    "failed",
    "skipped",
  ]);
});
it("forged citations and authority fields never become accepted drafts", async () => {
  const id = await start();
  await processRun(users.owner, a, id, {
    ...localEngine,
    async generate(context, signal) {
      const value = await localEngine.generate(context, signal);
      const output = JSON.parse(value.text);
      output.citations = [{ documentId: randomUUID(), chunk: 1 }];
      return { ...value, text: JSON.stringify(output) };
    },
  });
  expect((await getRun(users.owner, a, id)).run.error_code).toBe(
    "invalid_citations",
  );
  const next = await start();
  await processRun(users.owner, a, next, {
    ...localEngine,
    async generate(context, signal) {
      const value = await localEngine.generate(context, signal);
      return {
        ...value,
        text: JSON.stringify({ ...JSON.parse(value.text), approved: true }),
      };
    },
  });
  expect((await getRun(users.owner, a, next)).run.output).toBeNull();
});
it("unknown usage stays unknown and budget violations are recorded", async () => {
  const invalid = await start(users.owner, paidSkill);
  await processRun(users.owner, a, invalid, {
    ...synthetic,
    async generate(context, signal) {
      const value = await localEngine.generate(context, signal);
      return { ...value, usage: null };
    },
  });
  expect((await getRun(users.owner, a, invalid)).run).toMatchObject({
    error_code: "invalid_usage",
    input_tokens: null,
    cost_microusd: null,
    usage_kind: "unknown",
  });
  const excessive = await start(users.owner, paidSkill);
  await processRun(users.owner, a, excessive, {
    ...synthetic,
    async generate(context, signal) {
      const value = await localEngine.generate(context, signal);
      return { ...value, usage: { inputTokens: 16001, outputTokens: 1 } };
    },
  });
  expect((await getRun(users.owner, a, excessive)).run).toMatchObject({
    error_code: "budget_exceeded",
    input_tokens: 16001,
  });
});
it("zero-cost ceilings prevent a paid adapter call before it starts", async () => {
  const generate = vi.fn(synthetic.generate);
  const id = await start();
  await processRun(users.owner, a, id, { ...synthetic, generate });
  expect(generate).not.toHaveBeenCalled();
  expect((await getRun(users.owner, a, id)).run.error_code).toBe(
    "budget_exceeded",
  );
});
it("missing ready documents or archived sources fail before invoking the engine", async () => {
  const emptyVersion = await publishProcedure(users.owner, a, {
    procedureId: null,
    title: "Empty source procedure",
    instructions: "Review a source that has no ready document.",
    sourceIds: [privateSource],
  });
  const emptySkill = await createSkill(users.owner, a, {
    name: "Empty test",
    versionId: emptyVersion,
    operation: "source_brief",
    maxTokens: 8000,
    maxCostMicrousd: 0,
    timeoutMs: 1000,
  });
  const generate = vi.fn(localEngine.generate);
  const id = await start(users.owner, emptySkill);
  await processRun(users.owner, a, id, { ...localEngine, generate });
  expect(generate).not.toHaveBeenCalled();
  expect((await getRun(users.owner, a, id)).run.error_code).toBe(
    "missing_sources",
  );
  await saveSource(users.owner, a, source, { ...sourceInput, archived: true });
  const archived = await start();
  await processRun(users.owner, a, archived);
  expect((await getRun(users.owner, a, archived)).run.error_code).toBe(
    "missing_sources",
  );
  await saveSource(users.owner, a, source, sourceInput);
});
it("timeouts abort cooperative engines and persist failure without guessed costs", async () => {
  const id = await start(users.owner, paidSkill);
  let aborted = false;
  await processRun(users.owner, a, id, {
    ...synthetic,
    generate: async (_, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("secret provider detail"));
        }),
      ),
  });
  expect(aborted).toBe(true);
  const result = await getRun(users.owner, a, id);
  expect(result.run).toMatchObject({
    status: "timed_out",
    error_code: "timeout",
    output: null,
    cost_microusd: null,
  });
  expect(result.steps.map((s) => s.status)).toEqual([
    "succeeded",
    "failed",
    "skipped",
    "skipped",
  ]);
});
it("late results cannot overwrite expired terminal runs", async () => {
  const id = await start(users.member);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const job = processRun(users.member, a, id, {
    ...localEngine,
    async generate(context, signal) {
      entered.resolve();
      await gate.promise;
      return localEngine.generate(context, signal);
    },
  });
  await entered.promise;
  await migration.query(
    "UPDATE app.agent_run SET deadline=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  expect((await getRun(users.member, a, id)).run.status).toBe("timed_out");
  gate.resolve();
  await expect(job).rejects.toMatchObject({ code: "55000" });
  expect((await getRun(users.member, a, id)).run.output).toBeNull();
});
it("concurrent processing allows only one claim", async () => {
  const id = await start(users.member);
  const results = await Promise.allSettled([
    processRun(users.member, a, id),
    processRun(users.member, a, id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await getRun(users.member, a, id)).run.status).toBe("draft_ready");
});
it("source revocation hides derived history and fails an in-flight run closed", async () => {
  const id = await start(users.member);
  await processRun(users.member, a, id, {
    ...localEngine,
    async generate(context, signal) {
      await saveSource(users.owner, a, source, {
        ...sourceInput,
        scope: "private",
      });
      return localEngine.generate(context, signal);
    },
  });
  await expect(getRun(users.member, a, id)).rejects.toMatchObject({
    status: 404,
  });
  expect(
    (
      await asActor(users.member, a, (db) =>
        db.query("SELECT * FROM app.agent_step"),
      )
    ).rows,
  ).toEqual([]);
  await saveSource(users.owner, a, source, sourceInput);
  expect((await getRun(users.member, a, id)).run).toMatchObject({
    error_code: "access_changed",
    output: null,
  });
});
it("disabled skills reject new runs and processing", async () => {
  const id = await start(users.member);
  await toggleSkill(users.owner, a, skill, false);
  await expect(start(users.member)).rejects.toMatchObject({ code: "P0002" });
  await expect(processRun(users.member, a, id)).rejects.toMatchObject({
    code: "55000",
  });
  await toggleSkill(users.owner, a, skill, true);
});
it("interrupted queued runs expire and audit events contain no inputs or drafts", async () => {
  const id = await start(users.member);
  await migration.query(
    "UPDATE app.agent_run SET deadline=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  const result = await getRun(users.member, a, id);
  expect(result.run.status).toBe("timed_out");
  expect(result.steps[0].status).toBe("failed");
  const events = (
    await asActor(users.owner, a, (db) =>
      db.query(
        "SELECT action,metadata FROM app.audit_event WHERE action LIKE 'run.%'",
      ),
    )
  ).rows;
  expect(events.some((e) => e.action === "run.finished")).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(
    /Fictional context|client@example|written brief|provider secret/,
  );
});
