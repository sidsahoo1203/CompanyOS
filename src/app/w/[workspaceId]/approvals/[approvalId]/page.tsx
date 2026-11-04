import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/lib/page-session";
import { workspaceIdSchema } from "@/lib/validation";
import { getApproval } from "@/lib/approvals";
import { AppError } from "@/lib/errors";
import { ApprovalDetail } from "@/components/approval-detail";
export const metadata = { title: "Approval request" };
export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ workspaceId: string; approvalId: string }>;
}) {
  const { workspaceId, approvalId } = await params;
  const { session } = await workspacePage(workspaceId);
  if (!workspaceIdSchema.safeParse(approvalId).success) notFound();
  await getApproval(session.user.id, workspaceId, approvalId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link href={"/w/" + workspaceId + "/approvals"}>Back to approvals</Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">APPROVAL REQUEST</p>
          <h1>Review the exact action</h1>
        </div>
      </div>
      {/* Remount per revision so a confirmation never carries over to new content. */}
      <ApprovalDetail
        key={approvalId}
        workspaceId={workspaceId}
        approvalId={approvalId}
      />
    </>
  );
}
