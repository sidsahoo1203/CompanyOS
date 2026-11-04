"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
import type { AgentRun, AgentStep } from "@/lib/agents";
import { runMessages } from "@/lib/agent-contracts";
import { CitationList } from "./knowledge-panel";
type Detail = { run: AgentRun; steps: AgentStep[] };
export function RunDetail({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const router = useRouter();
  const url = "/api/workspaces/" + workspaceId + "/runs/" + runId;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      setData(null);
      throw new Error(
        "Run unavailable. Access may have changed. Return to your history.",
      );
    }
    setData(await response.json());
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const value: Detail = await response.json();
        if (active) {
          setData(value);
          if (value.run.status === "running")
            timer = setTimeout(() => void load(), 2000);
        }
      } catch {
        if (active) {
          setData(null);
          setError(
            "Run unavailable. Return to your history or refresh this page.",
          );
        }
      }
    }
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, busy]);
  async function process() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url + "/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(26000),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Processing failed.");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Processing failed.");
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function requestApproval(proposalIndex: number) {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ id: string }>(
        "/api/workspaces/" + workspaceId + "/approvals",
        "POST",
        { runId, proposalIndex },
      );
      router.push("/w/" + workspaceId + "/approvals/" + result.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Approval request failed.",
      );
      setBusy(false);
    }
  }
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>{error || "Loading run history…"}</p>
    );
  const { run, steps } = data;
  return (
    <>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>{run.input.objective}</h2>
        <p role="status" className="notice">
          Run status: {run.status}
        </p>
        {run.status === "queued" && (
          <>
            <p>
              This saved run has not started. Processing produces a local draft
              for review.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void process()}
            >
              {busy ? "Processing…" : "Process draft"}
            </button>
          </>
        )}
        {/* Plain text: the status notice above is the single live region. */}
        {run.status === "running" && (
          <p>Processing. This view checks for completion automatically.</p>
        )}
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() =>
            void refresh().catch((cause) => setError(cause.message))
          }
        >
          Refresh run
        </button>
        {run.error_code && (
          <p className="notice error" role="alert">
            {runMessages[run.error_code] ??
              "Run failed safely. No action was executed."}
          </p>
        )}
        <h3>Steps</h3>
        <ol className="run-steps">
          {steps.map((step) => (
            <li key={step.ordinal}>
              <strong>{step.name}</strong>
              <span className="badge">{step.status}</span>
              {step.finished_at && (
                <span className="hint">
                  {new Date(step.finished_at).toLocaleTimeString()}
                </span>
              )}
            </li>
          ))}
        </ol>
        <h3>Usage</h3>
        <dl className="details">
          <div>
            <dt>Engine</dt>
            <dd>{run.engine ?? "Not called"}</dd>
          </div>
          <div>
            <dt>Usage basis</dt>
            <dd>
              {run.usage_kind === "not_applicable"
                ? "Local drafting; no model tokens"
                : run.usage_kind}
            </dd>
          </div>
          <div>
            <dt>Input / output tokens</dt>
            <dd>
              {run.input_tokens ?? "Unknown"} / {run.output_tokens ?? "Unknown"}
            </dd>
          </div>
          <div>
            <dt>Cost (USD)</dt>
            <dd>
              {run.cost_microusd === null
                ? "Unknown"
                : "$" + (Number(run.cost_microusd) / 1000000).toFixed(6)}
            </dd>
          </div>
        </dl>
        <details>
          <summary>Saved input</summary>
          <pre className="contract">{JSON.stringify(run.input, null, 2)}</pre>
        </details>
      </section>
      {run.output && (
        <section className="panel">
          <h2>Draft for human review</h2>
          <p>{run.output.summary}</p>
          <p className="document-text">{run.output.draft}</p>
          <h3>Verified citation links</h3>
          <CitationList citations={run.citations ?? []} />
          {run.output.proposals.length > 0 && (
            <>
              <h3>Blocked proposals</h3>
              {run.output.proposals.map((proposal, index) => (
                <article className="notice" key={index}>
                  <h4>{proposal.kind}</h4>
                  <p>Proposed target: {proposal.target}</p>
                  <p className="document-text">{proposal.payload}</p>
                  <p>
                    <strong>Approval required. Execution disabled.</strong>{" "}
                    {proposal.reason}
                  </p>
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => void requestApproval(index)}
                  >
                    Request approval
                  </button>
                </article>
              ))}
            </>
          )}
          <p className="hint">
            Draft ready does not mean approved, sent, or executed. Source
            citations establish provenance, not factual validation of
            model-written claims.
          </p>
        </section>
      )}
    </>
  );
}
