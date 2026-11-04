import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { noStore, body } from "@/lib/http";
import { publicError } from "@/lib/errors";
import { logUnexpected } from "@/lib/log";
import { z } from "zod";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const headers = new Headers(request.headers);
    // Local-only app: do not trust client-supplied forwarded IP headers.
    headers.set("x-companyos-client-ip", "127.0.0.1");
    const parsed =
      request.method === "POST"
        ? await body(request, z.record(z.string(), z.unknown()))
        : undefined;
    // A password change must end every other session, whatever the client asks.
    if (parsed && new URL(request.url).pathname.endsWith("/change-password"))
      parsed.revokeOtherSessions = true;
    const payload = parsed ? JSON.stringify(parsed) : undefined;
    headers.delete("content-length");
    const safeRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: payload,
    });
    const handlers = toNextJsHandler(getAuth());
    const response = await (request.method === "POST"
      ? handlers.POST(safeRequest)
      : handlers.GET(safeRequest));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    // Same mapping as api(): invalid input is the client's error, not a 503.
    const result =
      error instanceof z.ZodError
        ? { status: 400, message: "Check the supplied details." }
        : publicError(error);
    const reference =
      result.status >= 500
        ? logUnexpected("auth.unexpected_error", error, {
            method: request.method,
            path: new URL(request.url).pathname,
          })
        : undefined;
    return Response.json(
      reference
        ? { error: result.message + " Reference: " + reference, reference }
        : { error: result.message },
      { status: result.status, headers: noStore },
    );
  }
}
export { handle as GET, handle as POST };
