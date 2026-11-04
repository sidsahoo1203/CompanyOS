"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApprovalSummary } from "@/lib/approvals";
import { personLabel, statusLabels } from "@/lib/approval-contracts";
type Inbox = { approvals: ApprovalSummary[]; canDecide: boolean };
export function ApprovalInbox({ workspaceId }: { workspaceId: string }) {
  const url = "/api/workspaces/" + workspaceId + "/approvals";
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value: Inbox = await response.json();
        if (active) {
          setData(value);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Could not load approvals. Refresh to retry.");
      });
    return () => {
      active = false;
    };
  }, [url, version]);
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>{error || "Loading approvals…"}</p>
    );
  const waiting = data.approvals.filter((item) => item.status === "pending");
  const history = data.approvals.filter((item) => item.status !== "pending");
  const list = (items: ApprovalSummary[], empty: string) =>
    !items.length ? (
      <p>{empty}</p>
    ) : (
      <ul className="document-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <Link href={"/w/" + workspaceId + "/approvals/" + item.id}>
                Send message to {item.target}
              </Link>
              <p className="hint">
                Requested by{" "}
                {personLabel(item.requester_name, item.requester_email)} ·
                Revision {item.revision} ·{" "}
                {item.status === "pending"
                  ? "Expires " + new Date(item.expires_at).toLocaleString()
                  : item.decided_at
                    ? "Decided " +
                      new Date(item.decided_at).toLocaleString() +
                      (item.decider_email
                        ? " by " +
                          personLabel(item.decider_name, item.decider_email)
                        : "")
                    : "Updated " + new Date(item.created_at).toLocaleString()}
              </p>
            </div>
            <span className="badge">
              {statusLabels[item.status] ?? item.status}
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <>
      <p className="notice">
        {data.canDecide
          ? "You can approve or reject requests whose sources you can read. You cannot approve content you wrote unless you are the workspace owner."
          : "You see the approval requests you submitted. Owners and admins decide them."}{" "}
        Approving records the exact action in a local outbox on this computer;
        nothing is emailed or sent to an external service.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>Waiting for decision</h2>
        <button
          className="button secondary small"
          onClick={() => setVersion((value) => value + 1)}
        >
          Refresh inbox
        </button>
        {list(
          waiting,
          "No approval requests are waiting. Request approval from a draft run's proposal.",
        )}
      </section>
      <section className="panel">
        <h2>History</h2>
        <p className="hint">Latest revision of each request; up to 200.</p>
        {list(history, "No decided or expired requests yet.")}
      </section>
    </>
  );
}
