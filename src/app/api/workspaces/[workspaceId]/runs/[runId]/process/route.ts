import { api } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { processRun } from "@/lib/agents";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return processRun(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.runId),
    );
  });
}
