import { api } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { getRun } from "@/lib/agents";
export function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return getRun(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.runId),
    );
  });
}
