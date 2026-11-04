import { z } from "zod";
import { AppError } from "./errors";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const sourceSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).default(""),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    scope: z.enum(["workspace", "admins", "private"]),
    archived: z.boolean().default(false),
  })
  .strict();
export type SourceInput = z.infer<typeof sourceSchema>;
export const querySchema = z
  .object({ question: z.string().trim().min(2).max(500) })
  .strict();
export const chunksSchema = z
  .array(
    z
      .object({
        location: z.string().min(1).max(120),
        content: z.string().trim().min(1).max(2000),
      })
      .strict(),
  )
  .min(1)
  .max(500);
export type Chunk = z.infer<typeof chunksSchema>[number];
export function validateUpload(
  filename: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  // Reject control bytes deliberately: filenames never become filesystem paths.
  if (
    !filename ||
    filename.length > 160 ||
    // eslint-disable-next-line no-control-regex
    /[\\/:\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(filename) ||
    filename.includes("..") ||
    filename.trim() !== filename
  )
    throw new AppError(
      400,
      "Use a plain filename without paths or hidden control characters.",
    );
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new AppError(413, "Choose a nonempty file no larger than 5 MiB.");
  const ext = filename.split(".").pop()?.toLowerCase();
  const types: Record<string, string[]> = {
    txt: ["text/plain"],
    md: ["text/markdown", "text/plain"],
    csv: [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "text/plain",
    ],
    pdf: ["application/pdf"],
    docx: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  };
  if (!ext || !types[ext])
    throw new AppError(
      415,
      "Supported formats: PDF, DOCX, TXT, CSV and Markdown.",
    );
  if (
    mediaType &&
    mediaType !== "application/octet-stream" &&
    !types[ext].includes(mediaType.split(";")[0].toLowerCase())
  )
    throw new AppError(415, "The file type does not match its extension.");
  const head = Buffer.from(bytes.subarray(0, 8));
  if (ext === "pdf" && !head.toString("ascii").startsWith("%PDF-"))
    throw new AppError(415, "This file is not a PDF.");
  if (
    ext === "docx" &&
    !head.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  )
    throw new AppError(415, "This file is not a DOCX.");
  if (["txt", "md", "csv"].includes(ext)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AppError(415, "Text documents must use UTF-8 encoding.");
    }
    // Binary signatures and non-text control bytes must not pass as text.
    if (
      // eslint-disable-next-line no-control-regex
      /^[\s\uFEFF]*(%PDF-|PK\x03\x04|MZ)/u.test(text) ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)
    )
      throw new AppError(
        415,
        "Binary content is not accepted as a text document.",
      );
  }
  return { extension: ext, mediaType: types[ext][0] };
}
export function suspiciousInstructions(text: string) {
  return /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|system|developer)\s+instructions|reveal\s+(the\s+)?system\s+prompt|bypass\s+(all\s+)?(permissions|approvals)|exfiltrat|<\|(?:system|im_start)\|>/i.test(
    text,
  );
}
export function searchTerms(question: string) {
  const stop = new Set(
    "a an the what when where who why how is are was were do does did can could should would please tell me about our company according to of for in on at and or with from it we i you".split(
      " ",
    ),
  );
  // \p{M} keeps combining marks (for example Devanagari vowel signs) inside
  // words; without it "शुल्क" splits into single letters that are dropped.
  return (
    question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*/gu) ?? []
  )
    .filter((term) => term.length > 1 && !stop.has(term))
    .slice(0, 20)
    .join(" ");
}
