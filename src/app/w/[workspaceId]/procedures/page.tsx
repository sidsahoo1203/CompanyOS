import { workspacePage } from "@/lib/page-session";
import { can } from "@/lib/permissions";
import { ProceduresPanel } from "@/components/procedures-panel";
export const metadata = { title: "Procedures and skills" };
export default async function Procedures({
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
          <p className="eyebrow">PROCEDURES & SKILLS</p>
          <h1>Turn your process into a reviewable draft</h1>
          <p className="muted">
            Publish a procedure, pin a skill to its version, and inspect every
            run.
          </p>
        </div>
      </div>
      <ProceduresPanel
        workspaceId={workspaceId}
        manage={can(workspace.role, "workspace:update")}
      />
    </>
  );
}
