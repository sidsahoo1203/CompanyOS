import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { sourceSchema } from "@/lib/knowledge-validation";
import { listKnowledge, saveSource } from "@/lib/knowledge";
type Context = { params: Promise<{ workspaceId: string }> };
export function GET(request: Request, context: Context) {
  return api(request, async (user) =>
    listKnowledge(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
    ),
  );
}
export function POST(request: Request, context: Context) {
  return api(request, async (user) => ({
    id: await saveSource(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      null,
      await body(request, sourceSchema),
    ),
  }));
}
