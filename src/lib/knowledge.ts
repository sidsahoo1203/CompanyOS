import "server-only";
import { createHash } from "node:crypto";
import { asActor } from "./db";
import { requirePermission } from "./workspaces";
import { AppError } from "./errors";
import {
  sourceSchema,
  validateUpload,
  searchTerms,
  type SourceInput,
} from "./knowledge-validation";
import {
  processBytes,
  processingMessages,
  type Scanner,
} from "./document-processing";
export type KnowledgeSource = SourceInput & {
  id: string;
  workspace_id: string;
  owner_id: string;
  created_at: Date;
};
export type KnowledgeDocument = {
  id: string;
  source_id: string;
  filename: string;
  media_type: string;
  byte_size: number;
  version: number;
  status: string;
  error_code: string | null;
  scanner: string | null;
  chunk_count: number;
  created_at: Date;
  processed_at: Date | null;
};
export type Citation = {
  documentId: string;
  sourceId: string;
  title: string;
  filename: string;
  version: number;
  chunk: number;
  location: string;
  quote: string;
  href: string;
};
const columns =
  "id,source_id,filename,media_type,byte_size,version,status,error_code,scanner,chunk_count,created_at,processed_at";
export function listKnowledge(userId: string, workspaceId: string) {
  return asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:read");
    const sources = (
      await db.query<KnowledgeSource>(
        "SELECT * FROM app.knowledge_source WHERE workspace_id=$1 ORDER BY created_at DESC",
        [workspaceId],
      )
    ).rows;
    const documents = (
      await db.query<KnowledgeDocument>(
        "SELECT " +
          columns +
          " FROM app.document WHERE workspace_id=$1 ORDER BY created_at DESC",
        [workspaceId],
      )
    ).rows;
    return { sources, documents };
  });
}
export function saveSource(
  userId: string,
  workspaceId: string,
  id: string | null,
  value: SourceInput,
) {
  const input = sourceSchema.parse(value);
  return asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:update");
    return (
      await db.query<{ id: string }>(
        "SELECT app.save_source($1,$2,$3,$4,$5,$6,$7) AS id",
        [
          workspaceId,
          id,
          input.title,
          input.description,
          input.tags,
          input.scope,
          input.archived,
        ],
      )
    ).rows[0].id;
  });
}
export async function authorizeUpload(
  userId: string,
  workspaceId: string,
  sourceId: string,
) {
  return asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:update");
    await db.query("SELECT app.require_source_admin($1,$2)", [
      workspaceId,
      sourceId,
    ]);
  });
}
export async function uploadDocument(
  userId: string,
  workspaceId: string,
  sourceId: string,
  filename: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  await authorizeUpload(userId, workspaceId, sourceId);
  const type = validateUpload(filename, mediaType, bytes);
  return asActor(userId, workspaceId, async (db) => {
    await db.query("SELECT app.knowledge_limit($1,'upload')", [workspaceId]);
    return (
      await db.query<{ id: string }>(
        "SELECT app.store_document($1,$2,$3,$4,$5,$6) AS id",
        [
          workspaceId,
          sourceId,
          filename,
          type.mediaType,
          Buffer.from(bytes),
          createHash("sha256").update(bytes).digest("hex"),
        ],
      )
    ).rows[0].id;
  });
}
export async function processDocument(
  userId: string,
  workspaceId: string,
  id: string,
  scanner?: Scanner,
) {
  const job = await asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:update");
    return (
      await db.query<{ token: string; payload: Buffer; filename: string }>(
        "SELECT * FROM app.claim_document($1,$2)",
        [workspaceId, id],
      )
    ).rows[0];
  });
  const result = await processBytes(
    job.payload,
    job.filename.split(".").pop()!.toLowerCase(),
    scanner,
  );
  await asActor(userId, workspaceId, (db) =>
    db.query("SELECT app.finish_document($1,$2,$3,$4,$5,$6,$7)", [
      workspaceId,
      id,
      job.token,
      result.status,
      result.error,
      result.scanner,
      JSON.stringify(result.chunks),
    ]),
  );
  return {
    status: result.status,
    message: result.error ? processingMessages[result.error] : null,
  };
}
export function getDocument(userId: string, workspaceId: string, id: string) {
  return asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:read");
    const document = (
      await db.query<KnowledgeDocument>(
        "SELECT " +
          columns +
          " FROM app.document WHERE workspace_id=$1 AND id=$2",
        [workspaceId, id],
      )
    ).rows[0];
    if (!document) throw new AppError(404, "Document not found.");
    const source = (
      await db.query<KnowledgeSource>(
        "SELECT * FROM app.knowledge_source WHERE workspace_id=$1 AND id=$2",
        [workspaceId, document.source_id],
      )
    ).rows[0];
    const chunks = (
      await db.query<{ ordinal: number; location: string; content: string }>(
        "SELECT ordinal,location,content FROM app.document_chunk WHERE workspace_id=$1 AND document_id=$2 ORDER BY ordinal",
        [workspaceId, id],
      )
    ).rows;
    await db.query("SELECT app.knowledge_event($1,$2)", [workspaceId, id]);
    return { document, source, chunks };
  });
}
export function retrieve(
  userId: string,
  workspaceId: string,
  question: string,
  operation: "search" | "answer" = "search",
) {
  const terms = searchTerms(question);
  return asActor(userId, workspaceId, async (db) => {
    await requirePermission(db, workspaceId, "workspace:read");
    await db.query("SELECT app.knowledge_limit($1,$2)", [
      workspaceId,
      operation,
    ]);
    if (!terms) return [];
    const rows = (
      await db.query<{
        document_id: string;
        source_id: string;
        title: string;
        filename: string;
        version: number;
        ordinal: number;
        location: string;
        content: string;
      }>(
        `
   SELECT d.id AS document_id,s.id AS source_id,s.title,d.filename,d.version,c.ordinal,c.location,c.content
   FROM app.document_chunk c JOIN app.document d ON d.workspace_id=c.workspace_id AND d.id=c.document_id
   JOIN app.knowledge_source s ON s.workspace_id=d.workspace_id AND s.id=d.source_id
   WHERE c.workspace_id=$1 AND NOT s.archived AND d.status='ready'
   AND NOT EXISTS(SELECT 1 FROM app.document newer WHERE newer.source_id=d.source_id AND newer.filename=d.filename AND newer.version>d.version)
   AND c.search_vector @@ plainto_tsquery('english',$2)
   ORDER BY ts_rank_cd(c.search_vector,plainto_tsquery('english',$2)) DESC,d.created_at DESC,c.ordinal LIMIT 6
  `,
        [workspaceId, terms],
      )
    ).rows;
    return rows.map((row) => ({
      documentId: row.document_id,
      sourceId: row.source_id,
      title: row.title,
      filename: row.filename,
      version: row.version,
      chunk: row.ordinal,
      location: row.location,
      quote: row.content,
      href:
        "/w/" +
        workspaceId +
        "/knowledge/documents/" +
        row.document_id +
        "#chunk-" +
        row.ordinal,
    })) satisfies Citation[];
  });
}
export async function answerQuestion(
  userId: string,
  workspaceId: string,
  question: string,
) {
  const citations = await retrieve(userId, workspaceId, question, "answer");
  return {
    mode: "source-excerpts" as const,
    status: citations.length
      ? ("sources_found" as const)
      : ("insufficient_knowledge" as const),
    answer: citations.length
      ? "These are matching excerpts from sources you can access. They may not answer every part of your question."
      : "I don’t know based on the sources you can access. Try different keywords or ask an administrator to add a reliable source.",
    citations,
  };
}
