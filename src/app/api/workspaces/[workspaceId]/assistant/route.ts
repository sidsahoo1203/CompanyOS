import { api, body } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { querySchema } from "@/lib/knowledge-validation";
import { answerQuestion } from "@/lib/knowledge";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (user) => {
    const { question } = await body(request, querySchema);
    return answerQuestion(
      user,
      workspaceIdSchema.parse((await context.params).workspaceId),
      question,
    );
  });
}
