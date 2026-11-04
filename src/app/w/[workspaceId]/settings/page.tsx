import { workspacePage } from "@/lib/page-session";
import { can } from "@/lib/permissions";
import { WorkspaceForm } from "@/components/workspace-form";
export const metadata = { title: "Settings" };
export default async function Settings({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await workspacePage(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE PREFERENCES</p>
          <h1>Settings</h1>
          <p className="muted">The essentials for {workspace.name}.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <h2>General</h2>
        {can(workspace.role, "workspace:update") ? (
          <WorkspaceForm
            id={workspaceId}
            initial={{
              name: workspace.name,
              industry: workspace.industry,
              timezone: workspace.timezone,
              language: workspace.language,
              retentionDays: workspace.retention_days,
            }}
          />
        ) : (
          <>
            <p className="notice">
              Only the owner or an administrator can change workspace settings.
            </p>
            <dl className="details">
              <div>
                <dt>Name</dt>
                <dd>{workspace.name}</dd>
              </div>
              <div>
                <dt>Time zone</dt>
                <dd>{workspace.timezone}</dd>
              </div>
              <div>
                <dt>Retention preference</dt>
                <dd>{workspace.retention_days} days</dd>
              </div>
            </dl>
          </>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>Local workspace</h2>
        <p className="muted">
          No billing, integrations, or AI execution are connected. Automatic
          retention, export, and data deletion workflows are planned for later
          milestones.
        </p>
      </section>
    </>
  );
}
