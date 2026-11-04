import { api, body } from "@/lib/http";
import {
  workspaceIdSchema,
  roleChangeSchema,
  removeMemberSchema,
} from "@/lib/validation";
import { changeMemberRole, removeMember } from "@/lib/workspaces";
export function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (userId) => {
    const input = await body(request, removeMemberSchema);
    await removeMember(
      userId,
      workspaceIdSchema.parse((await context.params).workspaceId),
      input.userId,
    );
    return { removed: true };
  });
}
export function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, async (userId) => {
    const input = await body(request, roleChangeSchema);
    await changeMemberRole(
      userId,
      workspaceIdSchema.parse((await context.params).workspaceId),
      input.userId,
      input.role,
    );
    return { saved: true };
  });
}
