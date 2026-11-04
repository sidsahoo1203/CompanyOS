import { api } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { getDocument } from "@/lib/knowledge";
export function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; documentId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return getDocument(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.documentId),
    );
  });
}
