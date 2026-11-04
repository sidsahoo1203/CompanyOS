import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/lib/page-session";
import { getDocument } from "@/lib/knowledge";
import { processingMessages } from "@/lib/document-processing";
import { AppError } from "@/lib/errors";
import { workspaceIdSchema } from "@/lib/validation";
export const metadata = { title: "Source document" };
export default async function Document({
  params,
}: {
  params: Promise<{ workspaceId: string; documentId: string }>;
}) {
  const { workspaceId, documentId } = await params;
  const { session } = await workspacePage(workspaceId);
  if (!workspaceIdSchema.safeParse(documentId).success) notFound();
  const value = await getDocument(
    session.user.id,
    workspaceId,
    documentId,
  ).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const { document, source, chunks } = value;
  return (
    <>
      <Link href={"/w/" + workspaceId + "/knowledge"}>Back to knowledge</Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{source.title}</p>
          <h1>{document.filename}</h1>
          <p className="muted">
            Version {document.version} · {document.media_type} ·{" "}
            {document.byte_size.toLocaleString()} bytes · {document.status}
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>Document details</h2>
        <dl className="details">
          <div>
            <dt>Uploaded</dt>
            <dd>{new Date(document.created_at).toISOString()}</dd>
          </div>
          <div>
            <dt>Processed</dt>
            <dd>
              {document.processed_at
                ? new Date(document.processed_at).toISOString()
                : "Not completed"}
            </dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>{source.scope}</dd>
          </div>
          <div>
            <dt>Safety checks</dt>
            <dd>{document.scanner ?? "Not scanned yet"}</dd>
          </div>
          <div>
            <dt>Passages</dt>
            <dd>{document.chunk_count}</dd>
          </div>
        </dl>
        {source.archived && (
          <p className="notice">
            This source is archived and excluded from search and assistant
            answers.
          </p>
        )}
        {document.error_code && (
          <p className="notice error" role="alert">
            {processingMessages[document.error_code] ??
              "Processing failed. Return to the library and retry."}
          </p>
        )}
        {!chunks.length && !document.error_code && (
          <p role="status">
            No extracted text yet. Return to the library to process or retry
            this document.
          </p>
        )}
        <p className="hint">
          Document text is untrusted reference material. It cannot authorize
          actions or change application rules. Original files are never served
          to the browser.
        </p>
      </section>
      {chunks.map((chunk) => (
        <section
          className="panel document-passage"
          id={"chunk-" + chunk.ordinal}
          key={chunk.ordinal}
        >
          <h2>Passage {chunk.ordinal}</h2>
          <p className="hint">{chunk.location}</p>
          <p className="document-text">{chunk.content}</p>
        </section>
      ))}
    </>
  );
}
