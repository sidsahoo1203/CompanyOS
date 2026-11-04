import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "./auth";
import { getWorkspace } from "./workspaces";
import { workspaceIdSchema } from "./validation";
import { AppError } from "./errors";
export async function requireSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}
export async function workspacePage(id: string) {
  const session = await requireSession();
  if (!workspaceIdSchema.safeParse(id).success) notFound();
  try {
    return { session, ...(await getWorkspace(session.user.id, id)) };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
