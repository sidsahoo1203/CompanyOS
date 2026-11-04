import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeClient, role, pgError, type Handler } from "./support/fake-db";
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({
  asActor: vi.fn(async (_u: string, _w: string, op: (db: unknown) => unknown) =>
    op(state.client),
  ),
}));
import {
  listAutomation,
  publishProcedure,
  createSkill,
  toggleSkill,
  createRun,
  getRun,
  processRun,
} from "@/lib/agents";
import { localEngine, RunFailure, type Engine } from "@/lib/agent-engine";
const ws = "11111111-1111-4111-8111-111111111111";
const run = "44444444-4444-4444-8444-444444444444";
const docId = "33333333-3333-4333-8333-333333333333";
const sourceId = "22222222-2222-4222-8222-222222222222";
const input = {
  objective: "Welcome Northwind",
  context: "Fictional",
  target: "client@example.test",
};
const passage = {
  document_id: docId,
  title: "Handbook",
  filename: "a.txt",
  version: 1,
  ordinal: 1,
  location: "Document text",
  content: "Kickoff starts with a brief.",
};
function script(handlers: Handler[]) {
  const fake = fakeClient(handlers);
  state.client = fake.client;
  return fake;
}
// A full happy-path script for processRun; individual tests override pieces.
function pipeline(
  overrides: { passages?: Handler[1][]; operation?: string } = {},
) {
  const passages = overrides.passages ?? [[passage], [passage]];
  let read = 0;
  return script([
    role("member"),
    ["app.claim_agent_run", [{ token: "lease-1" }]],
    [
      "to_jsonb(s) AS skill",
      [
        {
          input,
          skill: {
            enabled: true,
            operation: overrides.operation ?? "message_draft",
            timeout_ms: 1000,
            max_tokens: 8000,
            max_cost_microusd: 0,
          },
          version: { id: "v1", instructions: "Draft a welcome." },
        },
      ],
    ],
    [
      "FROM app.procedure_source WHERE workspace_id=$1 AND version_id",
      [{ source_id: sourceId }],
    ],
    [
      "AS document_id",
      () => {
        const next = passages[Math.min(read++, passages.length - 1)];
        if (next instanceof Error) throw next;
        return typeof next === "function" ? [] : (next as never);
      },
    ],
    ["app.advance_agent_run", []],
    ["app.finish_agent_run", []],
  ]);
}
function finished(calls: { sql: string; params: unknown[] }[]) {
  const call = calls.find((c) => c.sql.includes("finish_agent_run"))!;
  const [, , token, error, output, citations, usage] = call.params as [
    string,
    string,
    string,
    string | null,
    string | null,
    string | null,
    string,
  ];
  return {
    token,
    error,
    output: output && JSON.parse(output),
    citations: citations && JSON.parse(citations),
    usage: JSON.parse(usage),
  };
}
const engine = (generate: Engine["generate"], extra: Partial<Engine> = {}) =>
  ({ ...localEngine, id: "test-engine", generate, ...extra }) as Engine;
afterEach(() => vi.restoreAllMocks());
describe("input validation happens before any database work", () => {
  it("rejects unknown fields, missing objectives and duplicate sources", () => {
    const { calls } = script([]);
    expect(() =>
      createRun("u1", ws, {
        skillId: randomUUID(),
        requestKey: randomUUID(),
        input,
        approved: true,
      }),
    ).toThrow();
    expect(() =>
      createRun("u1", ws, {
        skillId: randomUUID(),
        requestKey: randomUUID(),
        input: { objective: "" },
      }),
    ).toThrow();
    expect(() =>
      publishProcedure("u1", ws, {
        procedureId: null,
        title: "SOP",
        instructions: "Instructions here",
        sourceIds: [sourceId, sourceId],
      }),
    ).toThrow();
    expect(() =>
      createSkill("u1", ws, {
        name: "Skill",
        versionId: randomUUID(),
        operation: "send_email" as never,
        maxTokens: 8000,
        maxCostMicrousd: 0,
        timeoutMs: 1000,
      }),
    ).toThrow();
    expect(calls).toEqual([]);
  });
});
describe("management permissions and error translation", () => {
  it("members cannot publish, create or toggle skills", async () => {
    for (const attempt of [
      () =>
        publishProcedure("u1", ws, {
          procedureId: null,
          title: "SOP",
          instructions: "Instructions here",
          sourceIds: [sourceId],
        }),
      () => toggleSkill("u1", ws, randomUUID(), false),
    ]) {
      script([role("member")]);
      await expect(attempt()).rejects.toMatchObject({ status: 403 });
    }
  });
  it("skills store the fixed v1 contracts, never caller-supplied schemas", async () => {
    const { calls } = script([
      role("admin"),
      ["app.create_skill", [{ id: "s1" }]],
    ]);
    await createSkill("u1", ws, {
      name: "Skill",
      versionId: randomUUID(),
      operation: "source_brief",
      maxTokens: 8000,
      maxCostMicrousd: 0,
      timeoutMs: 1000,
    });
    const params = calls.at(-1)!.params;
    expect(JSON.parse(params[4] as string)).toMatchObject({ type: "object" });
    expect(JSON.parse(params[5] as string).properties).toHaveProperty(
      "citations",
    );
  });
  it.each([
    ["P0002", 404, "unavailable"],
    ["54000", 429, "limit reached"],
    ["55000", 409, "already started"],
    ["23505", 409, "already submitted"],
  ])(
    "maps database code %s to %i with a specific message",
    async (code, status, text) => {
      script([role("member"), ["app.create_agent_run", pgError(code)]]);
      await expect(
        createRun("u1", ws, {
          skillId: randomUUID(),
          requestKey: randomUUID(),
          input,
        }),
      ).rejects.toMatchObject({
        code,
        status,
        message: expect.stringContaining(text),
      });
    },
  );
  it("other database errors pass through untranslated", async () => {
    script([
      role("member"),
      ["app.create_agent_run", pgError("08006", "connection lost")],
    ]);
    await expect(
      createRun("u1", ws, {
        skillId: randomUUID(),
        requestKey: randomUUID(),
        input,
      }),
    ).rejects.toMatchObject({ code: "08006", message: "connection lost" });
  });
  it("listing expires overdue runs first; a hidden run is 404", async () => {
    const { calls } = script([
      role("member"),
      ["app.expire_agent_runs", []],
      ["FROM app.procedure_version v", []],
      ["FROM app.agent_skill", []],
      ["FROM app.agent_run WHERE workspace_id=$1 ORDER BY", []],
    ]);
    await listAutomation("u1", ws);
    expect(calls[1].sql).toContain("expire_agent_runs");
    script([
      role("member"),
      ["app.expire_agent_runs", []],
      ["FROM app.agent_run WHERE workspace_id=$1 AND id=$2", []],
    ]);
    await expect(getRun("u1", ws, run)).rejects.toMatchObject({ status: 404 });
  });
});
describe("processRun outcomes", () => {
  it("a clean local draft stores blocked proposals, exact citations and zero usage", async () => {
    const { calls } = pipeline();
    await processRun("u1", ws, run);
    const result = finished(calls);
    expect(result.token).toBe("lease-1");
    expect(result.error).toBeNull();
    expect(result.output.proposals).toEqual([
      expect.objectContaining({
        kind: "send_message",
        target: "client@example.test",
        approvalRequired: true,
        executionAllowed: false,
        state: "blocked",
      }),
    ]);
    expect(result.citations).toEqual([
      expect.objectContaining({ documentId: docId, chunk: 1 }),
    ]);
    expect(result.usage).toEqual({
      engine: "local-excerpts-v1",
      kind: "not_applicable",
      inputTokens: 0,
      outputTokens: 0,
      costMicrousd: 0,
    });
    // Steps advance in order 1 -> 3 before finishing.
    expect(
      calls
        .filter((c) => c.sql.includes("advance_agent_run"))
        .map((c) => c.params[3]),
    ).toEqual([1, 2, 3]);
  });
  it("source briefs never carry proposals", async () => {
    const { calls } = pipeline({ operation: "source_brief" });
    await processRun("u1", ws, run);
    expect(finished(calls).output.proposals).toEqual([]);
  });
  it.each([
    ["timeout", new RunFailure("timeout")],
    ["budget_exceeded", new RunFailure("budget_exceeded")],
  ])("engine failure %s is stored without a draft", async (code, failure) => {
    const { calls } = pipeline();
    await processRun(
      "u1",
      ws,
      run,
      engine(async () => {
        throw failure;
      }),
    );
    expect(finished(calls)).toMatchObject({
      error: code,
      output: null,
      citations: null,
    });
  });
  it("malformed or forged engine output is rejected", async () => {
    for (const [text, code] of [
      ["not json", "malformed_output"],
      [
        JSON.stringify({
          summary: "x",
          draft: "y",
          citations: [{ documentId: randomUUID(), chunk: 1 }],
          proposals: [],
        }),
        "invalid_citations",
      ],
      [
        JSON.stringify({
          summary: "x",
          draft: "y",
          citations: [{ documentId: docId, chunk: 1 }],
          proposals: [],
          executionAllowed: true,
        }),
        "malformed_output",
      ],
    ]) {
      const { calls } = pipeline();
      await processRun(
        "u1",
        ws,
        run,
        engine(async () => ({ text, usage: null })),
      );
      expect(finished(calls)).toMatchObject({ error: code, output: null });
    }
  });
  it("a paid engine with unknown usage fails as invalid_usage", async () => {
    const { calls } = pipeline();
    await processRun(
      "u1",
      ws,
      run,
      engine(
        async (context, signal) => ({
          ...(await localEngine.generate(context, signal)),
          usage: { tokens: "unknown" },
        }),
        { local: false, pricing: { inputPerMillion: 0, outputPerMillion: 0 } },
      ),
    );
    expect(finished(calls)).toMatchObject({
      error: "invalid_usage",
      usage: { kind: "unknown", inputTokens: null, costMicrousd: null },
    });
  });
  it("database permission refusals mid-run become access_changed", async () => {
    const { calls } = pipeline();
    await processRun(
      "u1",
      ws,
      run,
      engine(async () => {
        throw pgError("42501");
      }),
    );
    expect(finished(calls).error).toBe("access_changed");
  });
  it("missing ready passages fail as missing_sources before the engine runs", async () => {
    const generate = vi.fn();
    const { calls } = pipeline({ passages: [[]] });
    await processRun("u1", ws, run, engine(generate));
    expect(generate).not.toHaveBeenCalled();
    expect(finished(calls).error).toBe("missing_sources");
  });
  it("a source that changes between drafting and release fails closed", async () => {
    const { calls } = pipeline({
      passages: [[passage], [{ ...passage, ordinal: 2 }]],
    });
    await processRun("u1", ws, run);
    expect(finished(calls)).toMatchObject({
      error: "missing_sources",
      output: null,
    });
  });
  it("unexpected crashes become engine_failed and are logged without content", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls } = pipeline();
    await processRun(
      "u1",
      ws,
      run,
      engine(async () => {
        throw new Error('crash while drafting "Welcome Northwind"');
      }),
    );
    expect(finished(calls).error).toBe("engine_failed");
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      event: "run.engine_failed",
      run,
      engine: "test-engine",
    });
    expect(JSON.stringify(line)).not.toContain("Northwind");
  });
  it("expected failures are not logged as errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    pipeline({ passages: [[]] });
    await processRun("u1", ws, run);
    expect(spy).not.toHaveBeenCalled();
  });
  it("a refused claim stops before reading any sources", async () => {
    const { calls } = script([
      role("member"),
      ["app.claim_agent_run", pgError("55000")],
    ]);
    await expect(processRun("u1", ws, run)).rejects.toMatchObject({
      status: 409,
    });
    expect(calls.some((c) => c.sql.includes("to_jsonb"))).toBe(false);
  });
});
