import "server-only";
import { asActor } from "./db";
import { requirePermission } from "./workspaces";
import { AppError } from "./errors";
import { logUnexpected } from "./log";
import {
  procedureSchema,
  skillSchema,
  startRunSchema,
  inputContract,
  outputContract,
  runMessages,
  type ProcedureInput,
  type SkillInput,
  type RunInput,
} from "./agent-contracts";
import {
  localEngine,
  emptyUsage,
  measuredUsage,
  enforceBudget,
  validateDraft,
  enforceDraftPolicy,
  withDeadline,
  RunFailure,
  type Engine,
} from "./agent-engine";
import type { Citation } from "./knowledge";
export type ProcedureVersion = {
  id: string;
  procedure_id: string;
  version: number;
  title: string;
  instructions: string;
  source_ids: string[];
  created_at: string;
};
export type Skill = {
  id: string;
  version_id: string;
  name: string;
  operation: "source_brief" | "message_draft";
  input_schema: unknown;
  output_schema: unknown;
  max_tokens: number;
  max_cost_microusd: number;
  timeout_ms: number;
  enabled: boolean;
};
export type AgentRun = {
  id: string;
  skill_id: string;
  input: RunInput;
  status: string;
  current_step: number;
  output: ReturnType<typeof enforceDraftPolicy> | null;
  citations: Citation[] | null;
  error_code: string | null;
  engine: string | null;
  usage_kind: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_microusd: string | null;
  created_at: string;
  deadline: string;
  finished_at: string | null;
};
export type AgentStep = {
  ordinal: number;
  name: string;
  status: string;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};
const runColumns =
  "id,skill_id,input,status,current_step,output,citations,error_code,engine,usage_kind,input_tokens,output_tokens,cost_microusd,created_at,deadline,finished_at";
// The shared mapper describes knowledge/membership failures; agent SQL reuses those codes.
const agentMessages: Record<string, [number, string]> = {
  P0002: [
    404,
    "This procedure, skill, source, or run is unavailable. It may be restricted, disabled, archived, or not ready.",
  ],
  "54000": [
    429,
    "Procedure, skill, or run limit reached. Wait a minute before creating more runs.",
  ],
  "55000": [
    409,
    "This run already started, finished, expired, or its skill is disabled, or three runs are already processing. Create a new run to try again.",
  ],
  "23505": [
    409,
    "This run request was already submitted with different details. Submit the form again.",
  ],
};
async function agentErrors<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const known = agentMessages[code];
    // Keep the database code so callers and tests can see which layer refused.
    if (known) throw Object.assign(new AppError(known[0], known[1]), { code });
    throw error;
  }
}
export function listAutomation(user: string, workspace: string) {
  return asActor(user, workspace, async (db) => {
    await requirePermission(db, workspace, "workspace:read");
    await db.query("SELECT app.expire_agent_runs($1)", [workspace]);
    const versions = (
      await db.query<ProcedureVersion>(
        "SELECT v.*,ARRAY(SELECT source_id FROM app.procedure_source ps WHERE ps.version_id=v.id) AS source_ids FROM app.procedure_version v WHERE v.workspace_id=$1 ORDER BY v.created_at DESC LIMIT 100",
        [workspace],
      )
    ).rows;
    const skills = (
      await db.query<Skill>(
        "SELECT * FROM app.agent_skill WHERE workspace_id=$1 ORDER BY created_at DESC",
        [workspace],
      )
    ).rows;
    const runs = (
      await db.query<AgentRun>(
        "SELECT " +
          runColumns +
          " FROM app.agent_run WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
        [workspace],
      )
    ).rows;
    return { versions, skills, runs };
  });
}
export function publishProcedure(
  user: string,
  workspace: string,
  value: ProcedureInput,
) {
  const input = procedureSchema.parse(value);
  return agentErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:update");
      return (
        await db.query<{ id: string }>(
          "SELECT app.publish_procedure($1,$2,$3,$4,$5) AS id",
          [
            workspace,
            input.procedureId,
            input.title,
            input.instructions,
            input.sourceIds,
          ],
        )
      ).rows[0].id;
    }),
  );
}
export function createSkill(
  user: string,
  workspace: string,
  value: SkillInput,
) {
  const input = skillSchema.parse(value);
  return agentErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:update");
      return (
        await db.query<{ id: string }>(
          "SELECT app.create_skill($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id",
          [
            workspace,
            input.versionId,
            input.name,
            input.operation,
            JSON.stringify(inputContract),
            JSON.stringify(outputContract),
            input.maxTokens,
            input.maxCostMicrousd,
            input.timeoutMs,
          ],
        )
      ).rows[0].id;
    }),
  );
}
export function toggleSkill(
  user: string,
  workspace: string,
  id: string,
  enabled: boolean,
) {
  return agentErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:update");
      await db.query("SELECT app.toggle_skill($1,$2,$3)", [
        workspace,
        id,
        enabled,
      ]);
      return { ok: true };
    }),
  );
}
export function createRun(user: string, workspace: string, value: unknown) {
  const input = startRunSchema.parse(value);
  return agentErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:read");
      return (
        await db.query<{ id: string }>(
          "SELECT app.create_agent_run($1,$2,$3,$4) AS id",
          [
            workspace,
            input.skillId,
            input.requestKey,
            JSON.stringify(input.input),
          ],
        )
      ).rows[0].id;
    }),
  );
}
export function getRun(user: string, workspace: string, id: string) {
  return asActor(user, workspace, async (db) => {
    await requirePermission(db, workspace, "workspace:read");
    await db.query("SELECT app.expire_agent_runs($1)", [workspace]);
    const run = (
      await db.query<AgentRun>(
        "SELECT " +
          runColumns +
          " FROM app.agent_run WHERE workspace_id=$1 AND id=$2",
        [workspace, id],
      )
    ).rows[0];
    if (!run)
      throw new AppError(
        404,
        "Run not found or its sources are no longer accessible.",
      );
    const steps = (
      await db.query<AgentStep>(
        "SELECT ordinal,name,status,error_code,started_at,finished_at FROM app.agent_step WHERE workspace_id=$1 AND run_id=$2 ORDER BY ordinal",
        [workspace, id],
      )
    ).rows;
    return { run, steps };
  });
}
async function runContext(user: string, workspace: string, id: string) {
  return asActor(user, workspace, async (db) => {
    await requirePermission(db, workspace, "workspace:read");
    const row = (
      await db.query<{
        input: RunInput;
        skill: Skill;
        version: ProcedureVersion;
      }>(
        `SELECT r.input,to_jsonb(s) AS skill,to_jsonb(v) AS version FROM app.agent_run r JOIN app.agent_skill s ON s.workspace_id=r.workspace_id AND s.id=r.skill_id JOIN app.procedure_version v ON v.workspace_id=s.workspace_id AND v.id=s.version_id WHERE r.workspace_id=$1 AND r.id=$2`,
        [workspace, id],
      )
    ).rows[0];
    if (!row || !row.skill.enabled) throw new RunFailure("access_changed");
    const sourceIds = (
      await db.query<{ source_id: string }>(
        "SELECT source_id FROM app.procedure_source WHERE workspace_id=$1 AND version_id=$2 ORDER BY source_id",
        [workspace, row.version.id],
      )
    ).rows.map((r) => r.source_id);
    const sources: Citation[] = [];
    for (const sourceId of sourceIds) {
      const passage = (
        await db.query<{
          document_id: string;
          title: string;
          filename: string;
          version: number;
          ordinal: number;
          location: string;
          content: string;
        }>(
          `
    SELECT d.id AS document_id,s.title,d.filename,d.version,c.ordinal,c.location,c.content FROM app.document_chunk c
    JOIN app.document d ON d.workspace_id=c.workspace_id AND d.id=c.document_id
    JOIN app.knowledge_source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id
    WHERE c.workspace_id=$1 AND s.id=$2 AND NOT s.archived AND d.status='ready'
    AND NOT EXISTS(SELECT 1 FROM app.document n WHERE n.source_id=d.source_id AND n.filename=d.filename AND n.version>d.version)
    ORDER BY d.created_at DESC,c.ordinal LIMIT 1`,
          [workspace, sourceId],
        )
      ).rows[0];
      if (!passage) throw new RunFailure("missing_sources");
      sources.push({
        documentId: passage.document_id,
        sourceId,
        title: passage.title,
        filename: passage.filename,
        version: passage.version,
        chunk: passage.ordinal,
        location: passage.location,
        quote: passage.content,
        href:
          "/w/" +
          workspace +
          "/knowledge/documents/" +
          passage.document_id +
          "#chunk-" +
          passage.ordinal,
      });
    }
    if (!sources.length) throw new RunFailure("missing_sources");
    return { ...row, sources };
  });
}
export async function processRun(
  user: string,
  workspace: string,
  id: string,
  engine: Engine = localEngine,
) {
  const token = await agentErrors(
    asActor(user, workspace, async (db) => {
      await requirePermission(db, workspace, "workspace:read");
      return (
        await db.query<{ token: string }>(
          "SELECT app.claim_agent_run($1,$2) AS token",
          [workspace, id],
        )
      ).rows[0].token;
    }),
  );
  let usage = emptyUsage(engine);
  let error: string | null = null;
  let output: ReturnType<typeof enforceDraftPolicy> | null = null;
  let citations: Citation[] | null = null;
  const advance = (step: number) =>
    asActor(user, workspace, (db) =>
      db.query("SELECT app.advance_agent_run($1,$2,$3,$4)", [
        workspace,
        id,
        token,
        step,
      ]),
    );
  try {
    const context = await runContext(user, workspace, id);
    await advance(1);
    const draftContext = {
      instructions: context.version.instructions,
      operation: context.skill.operation,
      input: context.input,
      sources: context.sources,
    };
    // Conservative preflight bound for future tokenized adapters; the local engine uses no model tokens.
    if (!engine.local) {
      const upperBound = measuredUsage(engine, {
        inputTokens: Buffer.byteLength(JSON.stringify(draftContext)),
        outputTokens: 2000,
      });
      enforceBudget(
        upperBound,
        context.skill.max_tokens,
        context.skill.max_cost_microusd,
      );
    }
    const result = await withDeadline(
      (signal) => engine.generate(draftContext, signal),
      context.skill.timeout_ms,
    );
    usage = measuredUsage(engine, result.usage);
    enforceBudget(
      usage,
      context.skill.max_tokens,
      context.skill.max_cost_microusd,
    );
    await advance(2);
    const validated = validateDraft(result.text, context.sources);
    await advance(3);
    const current = await runContext(user, workspace, id);
    if (
      context.sources.some(
        (source) =>
          !current.sources.some(
            (now) =>
              now.documentId === source.documentId &&
              now.chunk === source.chunk,
          ),
      )
    )
      throw new RunFailure("missing_sources");
    output = enforceDraftPolicy(validated, context.skill.operation);
    citations = context.sources.filter((source) =>
      validated.citations.some(
        (cite) =>
          cite.documentId === source.documentId && cite.chunk === source.chunk,
      ),
    );
  } catch (cause) {
    error =
      cause instanceof RunFailure && runMessages[cause.message]
        ? cause.message
        : typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            cause.code === "42501"
          ? "access_changed"
          : "engine_failed";
    // Expected failures are recorded on the run; only unexpected ones are logged.
    if (error === "engine_failed")
      logUnexpected("run.engine_failed", cause, {
        workspace,
        run: id,
        engine: engine.id,
      });
    output = null;
    citations = null;
  }
  await asActor(user, workspace, (db) =>
    db.query("SELECT app.finish_agent_run($1,$2,$3,$4,$5,$6,$7)", [
      workspace,
      id,
      token,
      error,
      output ? JSON.stringify(output) : null,
      citations ? JSON.stringify(citations) : null,
      JSON.stringify(usage),
    ]),
  );
  return { id };
}
