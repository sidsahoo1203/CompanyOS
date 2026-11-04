import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { startRunSchema } from "@/lib/agent-contracts";
import { createRun } from "@/lib/agents";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (user) => ({
    id: await createRun(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      await body(request, startRunSchema),
    ),
  }));
}
