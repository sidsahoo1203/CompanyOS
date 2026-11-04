import Link from "next/link";
import { workspacePage } from "@/lib/page-session";
import { can } from "@/lib/permissions";
export const metadata = { title: "Overview" };
export default async function Overview({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, members, invitations } = await workspacePage(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE OVERVIEW</p>
          <h1>A place to work together.</h1>
          <p className="muted">
            Your people, permissions, and the next step for {workspace.name}.
          </p>
        </div>
        <Link
          href={"/w/" + workspaceId + "/members"}
          className="button secondary"
        >
          Manage team
        </Link>
      </div>
      <section className="stats-grid" aria-label="Workspace status">
        <article className="stat">
          <p>Team members</p>
          <strong>{members.length}</strong>
          <span>People with workspace access</span>
        </article>
        <article className="stat">
          <p>Pending invitations</p>
          <strong>
            {can(workspace.role, "members:invite") ? invitations.length : "—"}
          </strong>
          <span>
            {can(workspace.role, "members:invite")
              ? "Active links awaiting acceptance"
              : "Visible to owners and admins"}
          </span>
        </article>
        <article className="stat">
          <p>Your access</p>
          <strong className="word-stat">{workspace.role}</strong>
          <span>Permissions checked on each request</span>
        </article>
      </section>
      <div className="dashboard-grid">
        <section className="panel setup-panel">
          <span className="badge">START HERE</span>
          <h2>Build your operating space</h2>
          <p className="muted">
            A little structure now. A clearer day for everyone.
          </p>
          <ol className="setup-list">
            <li>
              <span className="step complete" aria-label="Complete">
                ✓
              </span>
              <div>
                <h3>Create your workspace</h3>
                <p>{workspace.name} is ready.</p>
              </div>
              <span className="badge">Done</span>
            </li>
            <li>
              <span className="step">{members.length > 1 ? "✓" : "2"}</span>
              <div>
                <h3>Bring in your team</h3>
                <p>Give each teammate the access they need.</p>
                <Link href={"/w/" + workspaceId + "/members"}>
                  Open members
                </Link>
              </div>
            </li>
            <li>
              <span className="step muted-step">3</span>
              <div>
                <h3>Add company knowledge</h3>
                <p>Upload references and find answers with source citations.</p>
                <Link href={"/w/" + workspaceId + "/knowledge"}>
                  Open knowledge
                </Link>
              </div>
              <span className="badge">Available</span>
            </li>
            <li>
              <span className="step muted-step">4</span>
              <div>
                <h3>Turn a procedure into a draft</h3>
                <p>
                  Publish a procedure, pin a skill, and review cited drafts.
                </p>
                <Link href={"/w/" + workspaceId + "/procedures"}>
                  Open procedures
                </Link>
              </div>
              <span className="badge">Available</span>
            </li>
          </ol>
        </section>
        <section className="panel">
          <p className="eyebrow">WORKSPACE DETAILS</p>
          <h2>Set up for your agency</h2>
          <dl className="details">
            <div>
              <dt>Industry</dt>
              <dd>{workspace.industry}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{workspace.timezone}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>English</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                {new Intl.DateTimeFormat("en", {
                  dateStyle: "medium",
                  timeZone: workspace.timezone,
                }).format(workspace.created_at)}
              </dd>
            </div>
          </dl>
          <Link href={"/w/" + workspaceId + "/settings"} className="text-link">
            View workspace settings
          </Link>
        </section>
      </div>
      <section className="future-panel">
        <div className="future-icon" aria-hidden="true">
          ◎
        </div>
        <div>
          <h2>Review proposed actions</h2>
          <p>
            Drafted messages wait in Approvals with their exact recipient,
            content and sources. Approved actions are recorded in a local
            outbox; nothing is sent externally.
          </p>
        </div>
        <Link
          href={"/w/" + workspaceId + "/approvals"}
          className="button secondary"
        >
          Open approvals
        </Link>
      </section>
    </>
  );
}
