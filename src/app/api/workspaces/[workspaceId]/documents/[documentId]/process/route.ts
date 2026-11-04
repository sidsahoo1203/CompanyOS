import { api } from "@/lib/http";
import { workspaceIdSchema } from "@/lib/validation";
import { processDocument } from "@/lib/knowledge";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; documentId: string }> },
) {
  return api(request, async (user) => {
    const params = await context.params;
    return processDocument(
      user,
      workspaceIdSchema.parse(params.workspaceId),
      workspaceIdSchema.parse(params.documentId),
    );
  });
}
