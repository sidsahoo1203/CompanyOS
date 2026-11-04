"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
import { inputContract, outputContract } from "@/lib/agent-contracts";
import type { ProcedureVersion, Skill, AgentRun } from "@/lib/agents";
import type { KnowledgeSource } from "@/lib/knowledge";
type Library = {
  versions: ProcedureVersion[];
  skills: Skill[];
  runs: AgentRun[];
};
export function ProceduresPanel({
  workspaceId,
  manage,
}: {
  workspaceId: string;
  manage: boolean;
}) {
  const router = useRouter();
  const base = "/api/workspaces/" + workspaceId;
  const [data, setData] = useState<Library>({
    versions: [],
    skills: [],
    runs: [],
  });
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  async function refresh() {
    const response = await fetch(base + "/procedures", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load procedures.");
    setData(await response.json());
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(base + "/procedures", { cache: "no-store" }),
      fetch(base + "/knowledge", { cache: "no-store" }),
    ])
      .then(async (responses) => {
        if (responses.some((response) => !response.ok))
          throw new Error("Could not load procedures and sources.");
        const [library, knowledge] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (active) {
          setData(library);
          setSources(knowledge.sources);
        }
      })
      .catch(() => {
        if (active)
          setError("Could not load procedures. Reload this page to retry.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base]);
  const latest = data.versions.filter(
    (version, index, array) =>
      array.findIndex((item) => item.procedure_id === version.procedure_id) ===
      index,
  );
  const chosen = latest.find((version) => version.procedure_id === selected);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => {
      await requestJson(base + "/procedures", "POST", {
        procedureId: selected || null,
        title: form.get("title"),
        instructions: form.get("instructions"),
        sourceIds: form.getAll("sourceIds"),
      });
      await refresh();
      setMessage(
        "Procedure version published. Existing skills stay pinned to their original version.",
      );
    });
  }
  function skill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => {
      await requestJson(base + "/skills", "POST", {
        name: form.get("name"),
        versionId: form.get("versionId"),
        operation: form.get("operation"),
        maxTokens: Number(form.get("maxTokens")),
        maxCostMicrousd: Math.round(Number(form.get("cost")) * 1000000),
        timeoutMs: Number(form.get("timeout")) * 1000,
      });
      await refresh();
      setMessage("Skill created with an immutable version and contract.");
    });
  }
  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => {
      const result = await requestJson<{ id: string }>(base + "/runs", "POST", {
        skillId: form.get("skillId"),
        requestKey: crypto.randomUUID(),
        input: {
          objective: form.get("objective"),
          context: form.get("context"),
          target: form.get("target"),
        },
      });
      router.push("/w/" + workspaceId + "/runs/" + result.id);
    });
  }
  if (loading)
    return <p role="status">Loading procedures, skills, and your runs…</p>;
  return (
    <>
      <p className="notice">
        Draft-only local engine. No AI provider is connected. Instructions and
        sources cannot authorize actions. Proposed actions stay blocked.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {manage && (
        <div className="knowledge-grid">
          <section className="panel">
            <h2>Publish a procedure version</h2>
            <label htmlFor="procedure-select">
              Procedure
              <select
                id="procedure-select"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">New procedure</option>
                {latest.map((version) => (
                  <option
                    key={version.procedure_id}
                    value={version.procedure_id}
                  >
                    {version.title}
                  </option>
                ))}
              </select>
            </label>
            <form className="stack" key={selected} onSubmit={publish}>
              <label htmlFor="procedure-title">
                Procedure title
                <input
                  id="procedure-title"
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={chosen?.title ?? ""}
                />
              </label>
              <label htmlFor="procedure-instructions">
                Procedure instructions
                <textarea
                  id="procedure-instructions"
                  name="instructions"
                  required
                  minLength={10}
                  maxLength={6000}
                  defaultValue={chosen?.instructions ?? ""}
                />
              </label>
              <fieldset>
                <legend>Required knowledge sources</legend>
                {sources
                  .filter((source) => !source.archived)
                  .map((source) => (
                    <label className="check-label" key={source.id}>
                      <input
                        type="checkbox"
                        name="sourceIds"
                        value={source.id}
                        defaultChecked={chosen?.source_ids.includes(source.id)}
                      />
                      {source.title} ({source.scope})
                    </label>
                  ))}
                {!sources.some((source) => !source.archived) && (
                  <p>
                    Add an active source in{" "}
                    <Link href={"/w/" + workspaceId + "/knowledge"}>
                      Knowledge
                    </Link>{" "}
                    first.
                  </p>
                )}
              </fieldset>
              <button
                className="button fit"
                disabled={busy || !sources.some((source) => !source.archived)}
              >
                Publish version
              </button>
            </form>
          </section>
          <section className="panel">
            <h2>Create an agent skill</h2>
            <form className="stack" onSubmit={skill}>
              <label htmlFor="skill-name">
                Skill name
                <input
                  id="skill-name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label htmlFor="skill-version">
                Pinned procedure version
                <select
                  id="skill-version"
                  name="versionId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a version
                  </option>
                  {data.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.title} · v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="skill-operation">
                Draft type
                <select id="skill-operation" name="operation">
                  <option value="source_brief">Source brief</option>
                  <option value="message_draft">
                    Message proposal (blocked)
                  </option>
                </select>
              </label>
              <label htmlFor="skill-tokens">
                Maximum model tokens
                <input
                  id="skill-tokens"
                  name="maxTokens"
                  type="number"
                  min={128}
                  max={16000}
                  defaultValue={8000}
                  required
                />
              </label>
              <label htmlFor="skill-cost">
                Cost ceiling (USD)
                <input
                  id="skill-cost"
                  name="cost"
                  type="number"
                  min={0}
                  max={1}
                  step="0.000001"
                  defaultValue={0}
                  required
                />
              </label>
              <label htmlFor="skill-timeout">
                Timeout (seconds)
                <input
                  id="skill-timeout"
                  name="timeout"
                  type="number"
                  min={1}
                  max={15}
                  defaultValue={10}
                  required
                />
              </label>
              <button
                className="button fit"
                disabled={busy || !data.versions.length}
              >
                Create skill
              </button>
            </form>
          </section>
        </div>
      )}
      {!manage && (
        <p className="muted">
          Only owners and admins publish procedures or manage skills. You can
          run skills whose sources you can access.
        </p>
      )}
      <section className="panel">
        <h2>Procedure versions</h2>
        {!data.versions.length ? (
          <p>No accessible procedure versions yet.</p>
        ) : (
          data.versions.map((version) => (
            <details className="procedure-item" key={version.id}>
              <summary>
                {version.title} · v{version.version}
              </summary>
              <p className="document-text">{version.instructions}</p>
              <p className="hint">
                {version.source_ids.length} required source(s) · Published{" "}
                {new Date(version.created_at).toLocaleString()}
              </p>
            </details>
          ))
        )}
      </section>
      <section className="panel">
        <h2>Agent skills</h2>
        {!data.skills.length ? (
          <p>No accessible skills yet.</p>
        ) : (
          <ul className="document-list">
            {data.skills.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <p className="hint">
                    {item.operation} · {item.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {item.max_tokens} token ceiling ·{" "}
                    {"$" + (item.max_cost_microusd / 1000000).toFixed(6)}{" "}
                    ceiling
                  </p>
                  <p className="hint">
                    Pinned to{" "}
                    {data.versions.find(
                      (version) => version.id === item.version_id,
                    )?.title ?? "an older publication"}{" "}
                    · v
                    {data.versions.find(
                      (version) => version.id === item.version_id,
                    )?.version ?? "—"}
                  </p>
                </div>
                {manage && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await requestJson(
                          base + "/skills/" + item.id,
                          "PATCH",
                          { enabled: !item.enabled },
                        );
                        await refresh();
                      })
                    }
                  >
                    {item.enabled ? "Disable" : "Enable"} {item.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>Input and output contracts (v1)</summary>
          <h3>Input</h3>
          <pre className="contract">
            {JSON.stringify(inputContract, null, 2)}
          </pre>
          <h3>Untrusted engine output</h3>
          <pre className="contract">
            {JSON.stringify(outputContract, null, 2)}
          </pre>
          <p>
            Approval and execution permissions are added by application policy,
            never supplied by the drafting engine.
          </p>
        </details>
      </section>
      <section className="panel">
        <h2>Create a draft run</h2>
        <form className="stack" onSubmit={run}>
          <label htmlFor="run-skill">
            Agent skill
            <select id="run-skill" name="skillId" required defaultValue="">
              <option value="" disabled>
                Select a skill
              </option>
              {data.skills
                .filter((item) => item.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label htmlFor="run-objective">
            Objective
            <input
              id="run-objective"
              name="objective"
              required
              minLength={2}
              maxLength={500}
            />
          </label>
          <label htmlFor="run-context">
            Additional context
            <textarea id="run-context" name="context" maxLength={2000} />
          </label>
          <label htmlFor="run-target">
            Proposed recipient (optional)
            <input id="run-target" name="target" maxLength={200} />
          </label>
          <button
            className="button fit"
            disabled={busy || !data.skills.some((item) => item.enabled)}
          >
            Create draft run
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Your run history</h2>
        <p className="hint">
          Only your runs are visible, and only while you retain access to all
          their required sources. Latest 100 runs.
        </p>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => void perform(refresh)}
        >
          Refresh history
        </button>
        {!data.runs.length ? (
          <p>No accessible runs yet.</p>
        ) : (
          <ul className="document-list">
            {data.runs.map((item) => (
              <li key={item.id}>
                <div>
                  <Link href={"/w/" + workspaceId + "/runs/" + item.id}>
                    {item.input.objective}
                  </Link>
                  <p className="hint">
                    {item.status} · {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
