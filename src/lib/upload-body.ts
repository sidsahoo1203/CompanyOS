import { AppError } from "./errors";
import { MAX_FILE_BYTES } from "./knowledge-validation";
export async function readUpload(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES)
    throw new AppError(413, "File exceeds 5 MiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Choose a file.");
  let size = 0;
  let timedOut = false;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 15000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new AppError(408, "Upload timed out.");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new AppError(413, "File exceeds 5 MiB.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
