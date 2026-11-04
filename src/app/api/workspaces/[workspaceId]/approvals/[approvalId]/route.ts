import { api } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { getApproval } from "@/lib/approvals";
export function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; approvalId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return getApproval(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.approvalId),
    );
  });
}
