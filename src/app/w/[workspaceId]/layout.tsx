import Link from "next/link";
import { workspacePage } from "@/lib/page-session";
import { WorkspaceNav } from "@/components/workspace-nav";
import { SignOutButton } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { session, workspace } = await workspacePage(workspaceId);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/onboarding">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CompanyOS
        </Link>
        <div className="workspace-label">
          <span className="eyebrow">WORKSPACE</span>
          <strong>{workspace.name}</strong>
          <Link href="/onboarding">Switch workspace</Link>
        </div>
        <WorkspaceNav id={workspaceId} />
        <div className="sidebar-note">
          <span className="badge dark">Approval release</span>
          <p>
            Your team stays in control.
            <br />
            Approved actions stay in a local outbox.
          </p>
        </div>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {session.user.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{session.user.name}</strong>
            <span className="muted-light">{workspace.role}</span>
          </div>
        </div>
        <SignOutButton />
      </aside>
      <div className="app-body">
        <header className="topbar">
          <span>{workspace.industry}</span>
          <span className="badge">Local development</span>
        </header>
        <main id="main" className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
