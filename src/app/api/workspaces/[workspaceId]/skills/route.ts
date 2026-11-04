import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { skillSchema } from "@/lib/agent-contracts";
import { createSkill } from "@/lib/agents";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (user) => ({
    id: await createSkill(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      await body(request, skillSchema),
    ),
  }));
}
