import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { requestApprovalSchema } from "@/lib/approval-contracts";
import { listApprovals, requestApproval } from "@/lib/approvals";
type Context = { params: Promise<{ workspaceId: string }> };
export function GET(request: Request, context: Context) {
  return api(request, async (user) =>
    listApprovals(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
    ),
  );
}
export function POST(request: Request, context: Context) {
  return api(request, async (user) => ({
    id: await requestApproval(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      await body(request, requestApprovalSchema),
    ),
  }));
}
