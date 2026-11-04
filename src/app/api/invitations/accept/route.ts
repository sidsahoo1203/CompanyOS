import { api, body } from "@/lib/http";
import { acceptSchema } from "@/lib/validation";
import { acceptInvitation } from "@/lib/workspaces";
export function POST(request: Request) {
  return api(request, async (userId) => {
    const input = await body(request, acceptSchema);
    return { id: await acceptInvitation(userId, input.token) };
  });
}
