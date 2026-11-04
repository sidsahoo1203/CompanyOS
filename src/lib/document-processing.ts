import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { logUnexpected } from "./log";
import {
  chunksSchema,
  suspiciousInstructions,
  type Chunk,
} from "./knowledge-validation";
export type ScanResult = { outcome: "allow" | "block"; label: string };
export type Scanner = (bytes: Uint8Array) => Promise<ScanResult>;
export const basicScanner: Scanner = async (bytes) => {
  const raw = Buffer.from(bytes).toString("latin1");
  const blocked =
    /EICAR-STANDARD-ANTIVIRUS-TEST-FILE|\/JavaScript\b|\/JS\b|\/Launch\b|\/EmbeddedFile\b/i.test(
      raw,
    );
  return {
    outcome: blocked ? "block" : "allow",
    label: "Basic local checks; antivirus not configured",
  };
};
export const processingMessages: Record<string, string> = {
  scan_blocked: "Quarantined by the upload safety checks. Upload a clean copy.",
  scanner_unavailable:
    "Processing blocked: a required antivirus scanner is not configured.",
  scan_failed: "The scanner could not complete. Retry when it is available.",
  active_content:
    "Quarantined: active content or embedded files are not accepted.",
  prompt_injection:
    "Quarantined: possible instructions targeting the assistant were detected.",
  invalid_format:
    "Unable to read this file. Try an unencrypted PDF, a standard DOCX, or UTF-8 text.",
  no_text: "No readable text was found. Scanned PDFs need OCR before upload.",
  page_limit: "This PDF exceeds the 100-page limit.",
  text_limit: "The extracted document exceeds the 200,000-character limit.",
  archive_limit:
    "The DOCX archive exceeds safety limits or contains unsafe paths.",
  timeout: "Processing timed out. Try a smaller file and retry.",
  parser_failed: "Document processing failed. Try a clean copy or retry.",
};
export async function parseInWorker(
  bytes: Uint8Array,
  extension: string,
  timeoutMs = 15000,
): Promise<Chunk[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.resolve(process.cwd(), "scripts/parse-document.mjs"),
      {
        workerData: { bytes, extension },
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
        },
        execArgv: [],
      },
    );
    worker.stdout?.resume();
    worker.stderr?.resume();
    let done = false;
    const finish = (error?: string, chunks?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(new Error(error));
      else {
        const result = chunksSchema.safeParse(chunks);
        if (result.success) resolve(result.data);
        else reject(new Error("parser_failed"));
      }
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    worker.on("message", (message) => finish(message.error, message.chunks));
    worker.on("error", () => finish("parser_failed"));
    worker.on("exit", () => {
      if (!done) finish("parser_failed");
    });
  });
}
export async function processBytes(
  bytes: Uint8Array,
  extension: string,
  scanner?: Scanner,
) {
  const label = "Basic local checks; antivirus not configured";
  try {
    if (process.env.UPLOAD_REQUIRE_ANTIVIRUS === "true" && !scanner)
      return {
        status: "quarantined" as const,
        error: "scanner_unavailable",
        scanner: "Not scanned",
        chunks: [],
      };
    let scan: ScanResult;
    try {
      scan = await Promise.race([
        (scanner ?? basicScanner)(bytes),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("scan_failed")),
            5000,
          );
          timer.unref();
        }),
      ]);
    } catch {
      return {
        status: "failed" as const,
        error: "scan_failed",
        scanner: "Scan failed",
        chunks: [],
      };
    }
    if (scan.outcome !== "allow")
      return {
        status: "quarantined" as const,
        error: "scan_blocked",
        scanner: scan.label,
        chunks: [],
      };
    const chunks = await parseInWorker(bytes, extension);
    if (chunks.some((chunk) => suspiciousInstructions(chunk.content)))
      return {
        status: "quarantined" as const,
        error: "prompt_injection",
        scanner: scan.label,
        chunks: [],
      };
    return {
      status: "ready" as const,
      error: null,
      scanner: scan.label,
      chunks,
    };
  } catch (error) {
    const code =
      error instanceof Error && processingMessages[error.message]
        ? error.message
        : "parser_failed";
    if (code === "parser_failed")
      logUnexpected("document.parser_failed", error, { extension });
    return {
      status:
        code === "active_content"
          ? ("quarantined" as const)
          : ("failed" as const),
      error: code,
      scanner: label,
      chunks: [],
    };
  }
}
