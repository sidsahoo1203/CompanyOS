import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { decisionSchema } from "@/lib/approval-contracts";
import { decideApproval } from "@/lib/approvals";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; approvalId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return decideApproval(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.approvalId),
      await body(request, decisionSchema),
    );
  });
}
