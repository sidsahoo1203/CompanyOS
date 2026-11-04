import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-session";
import { listWorkspaces } from "@/lib/workspaces";
export default async function DashboardRedirect() {
  const session = await requireSession();
  const workspaces = await listWorkspaces(session.user.id);
  redirect(workspaces[0] ? "/w/" + workspaces[0].id : "/onboarding");
}
