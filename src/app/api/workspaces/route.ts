import { api, body } from "@/lib/http";
import { workspaceSchema } from "@/lib/validation";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";
export function GET(request: Request) {
  return api(request, async (userId) => ({
    workspaces: await listWorkspaces(userId),
  }));
}
export function POST(request: Request) {
  return api(request, async (userId) => ({
    id: await createWorkspace(userId, await body(request, workspaceSchema)),
  }));
}
