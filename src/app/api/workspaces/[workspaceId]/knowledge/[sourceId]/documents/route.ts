import { api } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { workspaceIdSchema } from "@/lib/validation";
import { authorizeUpload, uploadDocument } from "@/lib/knowledge";
import { readUpload } from "@/lib/upload-body";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; sourceId: string }> },
) {
  return api(
    request,
    async (user) => {
      const params = await context.params;
      const workspaceId = workspaceIdSchema.parse(params.workspaceId);
      const sourceId = workspaceIdSchema.parse(params.sourceId);
      await authorizeUpload(user, workspaceId, sourceId);
      let filename: string;
      try {
        filename = decodeURIComponent(request.headers.get("x-file-name") ?? "");
      } catch {
        throw new AppError(400, "Invalid filename.");
      }
      return {
        id: await uploadDocument(
          user,
          workspaceId,
          sourceId,
          filename,
          request.headers.get("x-file-type") ?? "",
          await readUpload(request),
        ),
        status: "queued",
      };
    },
    true,
  );
}
