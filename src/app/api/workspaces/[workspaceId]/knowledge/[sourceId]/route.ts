import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { sourceSchema } from "@/lib/knowledge-validation";
import { saveSource } from "@/lib/knowledge";
export function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; sourceId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return {
      id: await saveSource(
        user,
        workspaceIdSchema.parse(params.workspaceId),
        workspaceIdSchema.parse(params.sourceId),
        await body(request, sourceSchema),
      ),
    };
  });
}
