import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { querySchema } from "@/lib/knowledge-validation";
import { retrieve } from "@/lib/knowledge";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (user) => {
    const { question } = await body(request, querySchema);
    return {
      citations: await retrieve(
        user,
        workspaceIdSchema.parse((await context.params).workspaceId),
        question,
      ),
    };
  });
}
