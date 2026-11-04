import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { editApprovalSchema } from "@/lib/approval-contracts";
import { editApproval } from "@/lib/approvals";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; approvalId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return editApproval(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.approvalId),
      await body(request, editApprovalSchema),
    );
  });
}
