import { workspacePage } from "@/lib/page-session";
import { KnowledgeAssistant } from "@/components/knowledge-assistant";
export const metadata = { title: "Knowledge assistant" };
export default async function Assistant({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await workspacePage(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KNOWLEDGE ASSISTANT</p>
          <h1>Find the source behind an answer</h1>
          <p className="muted">
            Ask about the documents your team has shared with you.
          </p>
        </div>
      </div>
      <KnowledgeAssistant workspaceId={workspaceId} />
    </>
  );
}
