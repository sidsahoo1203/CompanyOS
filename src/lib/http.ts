import "server-only";
import { z } from "zod";
import { getAuth } from "./auth";
import { env } from "./env";
import { AppError, publicError } from "./errors";
import { logUnexpected } from "./log";
export const noStore = { "Cache-Control": "private, no-store" };
const NUL = String.fromCharCode(0);
export async function api(
  request: Request,
  action: (userId: string) => Promise<unknown>,
  rawUpload = false,
) {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      if (
        request.headers.get("origin") !== new URL(env().BETTER_AUTH_URL).origin
      )
        throw new AppError(403, "Request origin is not allowed.");
      // Fetch Metadata is defense in depth; browsers send it, local scripts may not.
      const site = request.headers.get("sec-fetch-site");
      if (site !== null && site !== "same-origin")
        throw new AppError(403, "Request origin is not allowed.");
      if (
        !request.headers
          .get("content-type")
          ?.startsWith(
            rawUpload ? "application/octet-stream" : "application/json",
          )
      )
        throw new AppError(
          415,
          rawUpload
            ? "Send the file as application/octet-stream."
            : "Send a JSON request.",
        );
    }
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session) throw new AppError(401, "Sign in to continue.");
    return Response.json(await action(session.user.id), { headers: noStore });
  } catch (error) {
    const result =
      error instanceof z.ZodError
        ? { status: 400, message: "Check the supplied details." }
        : publicError(error);
    if (result.status >= 500) {
      const reference = logUnexpected("api.unexpected_error", error, {
        method: request.method,
        path: new URL(request.url).pathname,
      });
      return Response.json(
        { error: result.message + " Reference: " + reference, reference },
        { status: result.status, headers: noStore },
      );
    }
    return Response.json(
      { error: result.message },
      { status: result.status, headers: noStore },
    );
  }
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (Number(request.headers.get("content-length") ?? 0) > 16384)
    throw new AppError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Request body is required.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        throw new AppError(413, "Request is too large.");
      }
      chunks.push(value);
    }
    let parsed: unknown;
    let nul = false;
    try {
      parsed = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
        (key, value) => {
          if (
            key.includes(NUL) ||
            (typeof value === "string" && value.includes(NUL))
          )
            nul = true;
          return value;
        },
      );
    } catch {
      throw new AppError(400, "Invalid JSON.");
    }
    // PostgreSQL text cannot store NUL; refuse it here instead of failing as a 503.
    if (nul) throw new AppError(400, "Text cannot contain NUL characters.");
    return schema.parse(parsed);
  } finally {
    reader.releaseLock();
  }
}
