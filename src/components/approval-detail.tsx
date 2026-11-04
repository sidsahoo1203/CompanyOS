"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
import { personLabel, statusLabels } from "@/lib/approval-contracts";
import type { ApprovalDetail as Detail } from "@/lib/approvals";
import { CitationList } from "./knowledge-panel";
const auditLabels: Record<string, string> = {
  "approval.requested": "Approval requested",
  "approval.edited": "Revision saved",
  "approval.approved": "Approved",
  "approval.rejected": "Rejected",
  "approval.expired": "Expired",
  "approval.denied": "Attempt refused",
  "action.executed": "Recorded in local outbox",
};
export function ApprovalDetail({
  workspaceId,
  approvalId,
}: {
  workspaceId: string;
  approvalId: string;
}) {
  const router = useRouter();
  const url = "/api/workspaces/" + workspaceId + "/approvals/" + approvalId;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [version, setVersion] = useState(0);
  // Reuse one key per reviewed digest so a retried request cannot execute twice.
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value: Detail = await response.json();
        if (active) setData(value);
      })
      .catch(() => {
        if (active) {
          setData(null);
          setError(
            "Approval request unavailable. Access may have changed. Return to the inbox.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [url, version]);
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
      setVersion((value) => value + 1);
    }
  }
  function decide(decision: "approve" | "reject", note: string) {
    if (!data) return;
    const digest = data.request.digest;
    const key = keys.current.get(digest + decision) ?? crypto.randomUUID();
    keys.current.set(digest + decision, key);
    void perform(async () => {
      await requestJson(url + "/decision", "POST", {
        decision,
        digest,
        idempotencyKey: key,
        note,
        ...(decision === "approve" ? { confirmed: true } : {}),
      });
      setMessage(
        decision === "approve"
          ? "Approved. The exact action was recorded in the local outbox; nothing was sent externally."
          : "Rejected. This request can no longer be approved.",
      );
    });
  }
  function decideFrom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    decide(
      submitter?.getAttribute("value") === "approve" ? "approve" : "reject",
      note,
    );
  }
  function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    requestJson<{ id: string }>(url + "/revisions", "POST", {
      digest: data.request.digest,
      target: form.get("target"),
      payload: form.get("payload"),
    })
      .then((result) =>
        router.push("/w/" + workspaceId + "/approvals/" + result.id),
      )
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Edit failed.");
        setBusy(false);
      });
  }
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Loading approval request…"}
      </p>
    );
  const { request, revisions, execution, audit, viewer, checks } = data;
  const approvable =
    viewer.canDecide &&
    !viewer.selfAuthored &&
    checks.recipientValid &&
    checks.contentSafe;
  return (
    <>
      <p role="status" className="notice">
        Status: {statusLabels[request.status] ?? request.status}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p className="notice success">{message}</p>}
      {request.status === "pending" && !checks.recipientValid && (
        <p className="notice error">
          The recipient is not one valid email address. Edit the request to set
          a recipient before it can be approved.
        </p>
      )}
      {request.status === "pending" && !checks.contentSafe && (
        <p className="notice error">
          Hidden or control characters were detected in the recipient or
          content. Edit the request before it can be approved.
        </p>
      )}
      <section className="panel">
        <h2>Exact action to review</h2>
        <div className="approval-exact">
          <dl className="details">
            <div>
              <dt>Action</dt>
              <dd>Send message</dd>
            </div>
            <div>
              <dt>Target (recipient)</dt>
              <dd>
                <strong>{request.target}</strong>
              </dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>
                {request.revision} of {revisions.length} · written by{" "}
                {personLabel(request.author_name, request.author_email)}
              </dd>
            </div>
            <div>
              <dt>Requested by</dt>
              <dd>
                {personLabel(request.requester_name, request.requester_email)}
              </dd>
            </div>
            <div>
              <dt>{request.status === "pending" ? "Expires" : "Requested"}</dt>
              <dd>
                {new Date(
                  request.status === "pending"
                    ? request.expires_at
                    : request.created_at,
                ).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Fingerprint (SHA-256)</dt>
              <dd>
                <code>{request.digest}</code>
              </dd>
            </div>
          </dl>
          <h3>Content (exact text)</h3>
          <pre className="approval-content">{request.payload}</pre>
          <h3>Expected effect</h3>
          <p>{request.expected_effect}</p>
        </div>
        <h3>Run inputs</h3>
        <dl className="details">
          <div>
            <dt>Objective</dt>
            <dd>{request.inputs.objective}</dd>
          </div>
          <div>
            <dt>Additional context</dt>
            <dd>{request.inputs.context || "None"}</dd>
          </div>
          <div>
            <dt>Recipient proposed in the run</dt>
            <dd>{request.inputs.target || "None"}</dd>
          </div>
        </dl>
        <h3>Sources cited by the draft</h3>
        <CitationList citations={request.sources} />
        <p className="hint">
          Sources show provenance only; they do not authorize this action.
        </p>
      </section>
      {viewer.canDecide && (
        <section className="panel">
          <h2>Decision</h2>
          {viewer.selfAuthored && (
            <p className="notice">
              You wrote this revision. Another admin or the workspace owner must
              approve it. You can still reject it.
            </p>
          )}
          <form className="stack" onSubmit={decideFrom}>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I reviewed the exact recipient, content, inputs, sources and
              expected effect.
            </label>
            <label htmlFor="decision-note">
              Decision note (optional)
              <textarea id="decision-note" name="note" maxLength={500} />
            </label>
            <div className="button-row">
              <button
                className="button"
                name="decision"
                value="approve"
                disabled={busy || !confirmed || !approvable}
              >
                Approve and record in local outbox
              </button>
              <button
                className="button danger"
                name="decision"
                value="reject"
                disabled={busy}
              >
                Reject
              </button>
            </div>
          </form>
        </section>
      )}
      {request.decided_at && (
        <section className="panel">
          <h2>Decision record</h2>
          <dl className="details">
            <div>
              <dt>Decision</dt>
              <dd>{statusLabels[request.status] ?? request.status}</dd>
            </div>
            <div>
              <dt>Decided by</dt>
              <dd>
                {personLabel(request.decider_name, request.decider_email)}
              </dd>
            </div>
            <div>
              <dt>Decided at</dt>
              <dd>{new Date(request.decided_at).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{request.decision_note || "None"}</dd>
            </div>
          </dl>
        </section>
      )}
      {execution && (
        <section className="panel">
          <h2>Local outbox record</h2>
          <p className="notice success">
            Recorded locally by {execution.executor}. Nothing was emailed or
            sent to an external service.
          </p>
          <dl className="details">
            <div>
              <dt>Execution ID</dt>
              <dd>
                <code>{execution.id}</code>
              </dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>
                {new Date(execution.executed_at).toLocaleString()} by{" "}
                {personLabel(execution.executor_name, execution.executor_email)}
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{execution.target}</dd>
            </div>
            <div>
              <dt>Approved fingerprint</dt>
              <dd>
                <code>{execution.digest}</code>
              </dd>
            </div>
          </dl>
          <pre className="approval-content">{execution.payload}</pre>
        </section>
      )}
      {viewer.canEdit && (
        <section className="panel">
          <h2>Edit before approval</h2>
          <p className="hint">
            Saving creates revision {request.revision + 1} with a new
            fingerprint and expiry. This revision can then never be approved.
          </p>
          <form className="stack" onSubmit={edit} key={request.id}>
            <label htmlFor="edit-target">
              Recipient email
              <input
                id="edit-target"
                name="target"
                type="email"
                required
                maxLength={254}
                defaultValue={checks.recipientValid ? request.target : ""}
              />
            </label>
            <label htmlFor="edit-payload">
              Message content
              <textarea
                id="edit-payload"
                name="payload"
                required
                maxLength={6000}
                rows={10}
                defaultValue={request.payload}
              />
            </label>
            <button className="button secondary fit" disabled={busy}>
              Save as new revision
            </button>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Revision history</h2>
        <ol className="run-steps">
          {revisions.map((item) => (
            <li key={item.id}>
              {item.id === request.id ? (
                <strong>Revision {item.revision} (this page)</strong>
              ) : (
                <Link href={"/w/" + workspaceId + "/approvals/" + item.id}>
                  Revision {item.revision}
                </Link>
              )}
              <span className="badge">
                {statusLabels[item.status] ?? item.status}
              </span>
              <span className="hint">
                {personLabel(item.author_name, item.author_email)} ·{" "}
                {new Date(item.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
        <p className="hint">
          <Link href={"/w/" + workspaceId + "/approvals"}>
            Back to approvals
          </Link>
        </p>
      </section>
      {audit.length > 0 && (
        <section className="panel">
          <h2>Audit trail</h2>
          <ol className="run-steps">
            {audit.map((entry, index) => (
              <li key={index}>
                <strong>{auditLabels[entry.action] ?? entry.action}</strong>
                <span className="badge">{entry.result}</span>
                <span className="hint">
                  {personLabel(entry.actor_name, entry.actor_email)} ·{" "}
                  {new Date(entry.created_at).toLocaleString()}
                  {entry.reason ? " · reason: " + entry.reason : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
