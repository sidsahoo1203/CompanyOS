import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/lib/page-session";
import { workspaceIdSchema } from "@/lib/validation";
import { getRun } from "@/lib/agents";
import { AppError } from "@/lib/errors";
import { RunDetail } from "@/components/run-detail";
export const metadata = { title: "Agent run" };
export default async function RunPage({
  params,
}: {
  params: Promise<{ workspaceId: string; runId: string }>;
}) {
  const { workspaceId, runId } = await params;
  const { session } = await workspacePage(workspaceId);
  if (!workspaceIdSchema.safeParse(runId).success) notFound();
  await getRun(session.user.id, workspaceId, runId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link href={"/w/" + workspaceId + "/procedures"}>Back to procedures</Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">RUN HISTORY</p>
          <h1>Draft run details</h1>
        </div>
      </div>
      <RunDetail workspaceId={workspaceId} runId={runId} />
    </>
  );
}
