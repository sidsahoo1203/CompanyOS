import { z } from "zod";
import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { toggleSkill } from "@/lib/agents";
export function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; skillId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    const value = await body(
      request,
      z.object({ enabled: z.boolean() }).strict(),
    );
    return toggleSkill(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.skillId),
      value.enabled,
    );
  });
}
