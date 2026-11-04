import { api, body } from "@/lib/http";
import { workspaceIdSchema, inviteSchema } from "@/lib/validation";
import { inviteMember } from "@/lib/workspaces";
export function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (userId) => {
    const input = await body(request, inviteSchema);
    return inviteMember(
      userId,
      workspaceIdSchema.parse((await context.params).workspaceId),
      input.email,
      input.role,
    );
  });
}
