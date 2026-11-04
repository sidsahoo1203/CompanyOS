import Link from "next/link";
import { requireSession } from "@/lib/page-session";
import { listWorkspaces } from "@/lib/workspaces";
import { WorkspaceForm } from "@/components/workspace-form";
import { SignOutButton } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your workspaces" };
export default async function Onboarding() {
  const session = await requireSession();
  const workspaces = await listWorkspaces(session.user.id);
  return (
    <main id="main" className="onboarding">
      <header className="public-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CompanyOS
        </Link>
        <SignOutButton />
      </header>
      <div className="onboarding-body">
        <p className="eyebrow">YOUR WORKSPACES</p>
        <h1>Welcome, {session.user.name}.</h1>
        <p className="muted">
          Choose a workspace or create a new one for your agency.
        </p>
        {workspaces.length > 0 && (
          <section className="workspace-list" aria-label="Your workspaces">
            {workspaces.map((workspace) => (
              <Link
                className="workspace-option"
                href={"/w/" + workspace.id}
                key={workspace.id}
              >
                <strong>{workspace.name}</strong>
                <span className="badge">{workspace.role}</span>
              </Link>
            ))}
          </section>
        )}
        <section className="panel">
          <h2>Create a workspace</h2>
          <p className="muted intro">
            You’ll be its owner. Invite your team after setup.
          </p>
          <WorkspaceForm />
        </section>
        <p className="hint">
          Have an invitation? Sign in first, then reopen its link.{" "}
          <Link href="/join">Enter an invitation code</Link>
        </p>
      </div>
    </main>
  );
}
