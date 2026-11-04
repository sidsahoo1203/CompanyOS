import { workspacePage } from "@/lib/page-session";
import { ApprovalInbox } from "@/components/approval-inbox";
export const metadata = { title: "Approvals" };
export default async function Approvals({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await workspacePage(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">APPROVALS</p>
          <h1>Review before anything happens</h1>
          <p className="muted">
            Every proposed action waits here with its exact recipient, content,
            sources and expected effect.
          </p>
        </div>
      </div>
      <ApprovalInbox workspaceId={workspaceId} />
    </>
  );
}
