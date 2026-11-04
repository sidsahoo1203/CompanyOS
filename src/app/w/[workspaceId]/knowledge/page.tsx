import { workspacePage } from "@/lib/page-session";
import { can } from "@/lib/permissions";
import { KnowledgePanel } from "@/components/knowledge-panel";
export const metadata = { title: "Knowledge" };
export default async function Knowledge({
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
          <p className="eyebrow">COMPANY KNOWLEDGE</p>
          <h1>Your shared reference library</h1>
          <p className="muted">
            Keep source documents organized, searchable, and visible to the
            right people.
          </p>
        </div>
      </div>
      <KnowledgePanel
        workspaceId={workspaceId}
        manage={can(workspace.role, "workspace:update")}
      />
    </>
  );
}
