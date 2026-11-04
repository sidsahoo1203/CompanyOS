import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { procedureSchema } from "@/lib/agent-contracts";
import { listAutomation, publishProcedure } from "@/lib/agents";
type Context = { params: Promise<{ workspaceId: string }> };
export function GET(request: Request, context: Context) {
  return api(request, async (user) =>
    listAutomation(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
    ),
  );
}
export function POST(request: Request, context: Context) {
  return api(request, async (user) => ({
    id: await publishProcedure(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      await body(request, procedureSchema),
    ),
  }));
}
