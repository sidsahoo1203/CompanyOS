import { api, body } from "@/lib/http";
import { workspaceIdSchema, workspaceSchema } from "@/lib/validation";
import { getWorkspace, updateWorkspace } from "@/lib/workspaces";
type Context = { params: Promise<{ workspaceId: string }> };
export function GET(request: Request, context: Context) {
  return api(request, async (userId) =>
    getWorkspace(
      userId,
      workspaceIdSchema.parse((await context.params).workspaceId),
    ),
  );
}
export function PATCH(request: Request, context: Context) {
  return api(request, async (userId) => {
    await updateWorkspace(
      userId,
      workspaceIdSchema.parse((await context.params).workspaceId),
      await body(request, workspaceSchema),
    );
    return { saved: true };
  });
}
