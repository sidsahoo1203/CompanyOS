import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  session: { user: { id: "user-1" } } as unknown,
  getWorkspace: vi.fn(),
  uploadDocument: vi.fn(async () => "doc-1"),
  authorizeUpload: vi.fn(async () => undefined),
  removeMember: vi.fn(async () => undefined),
  decideApproval: vi.fn(async () => ({ outcome: "rejected" })),
  processRun: vi.fn(async () => ({ id: "r" })),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("REDIRECT"), { to });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => mocks.session } }),
}));
vi.mock("@/lib/workspaces", () => ({
  getWorkspace: mocks.getWorkspace,
  removeMember: mocks.removeMember,
  changeMemberRole: vi.fn(),
}));
vi.mock("@/lib/knowledge", () => ({
  uploadDocument: mocks.uploadDocument,
  authorizeUpload: mocks.authorizeUpload,
}));
vi.mock("@/lib/approvals", () => ({ decideApproval: mocks.decideApproval }));
vi.mock("@/lib/agents", () => ({ processRun: mocks.processRun }));
import { proxy, config as proxyConfig } from "@/proxy";
import nextConfig from "../../next.config";
import { requireSession, workspacePage } from "@/lib/page-session";
import { AppError } from "@/lib/errors";
import { POST as upload } from "@/app/api/workspaces/[workspaceId]/knowledge/[sourceId]/documents/route";
import { DELETE as removeRoute } from "@/app/api/workspaces/[workspaceId]/members/route";
import { POST as decide } from "@/app/api/workspaces/[workspaceId]/approvals/[approvalId]/decision/route";
import { POST as processRoute } from "@/app/api/workspaces/[workspaceId]/runs/[runId]/process/route";
const origin = "http://127.0.0.1:3000";
const ws = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.session = { user: { id: "user-1" } };
});
describe("security headers", () => {
  const csp = (response: Response) =>
    response.headers.get("content-security-policy") ?? "";
  it("sets a strict nonce CSP, forwards the nonce to rendering and disables caching", () => {
    const response = proxy(new NextRequest(origin + "/w/x"));
    const policy = csp(response);
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "connect-src 'self'",
    ])
      expect(policy).toContain(directive);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses a fresh nonce per request and drops unsafe-eval in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = csp(proxy(new NextRequest(origin + "/")));
    const second = csp(proxy(new NextRequest(origin + "/")));
    expect(first).not.toBe(second);
    expect(first).not.toContain("unsafe-eval");
    vi.stubEnv("NODE_ENV", "development");
    expect(csp(proxy(new NextRequest(origin + "/")))).toContain(
      "'unsafe-eval'",
    );
  });
  it("skips only static assets", () => {
    const pattern = new RegExp("^" + proxyConfig.matcher[0] + "$");
    expect(pattern.test("/w/abc")).toBe(true);
    expect(pattern.test("/api/workspaces")).toBe(true);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/favicon.svg")).toBe(false);
  });
  it("every route sends anti-framing, isolation and no-referrer headers", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const [rule] = await nextConfig.headers!();
    expect(rule.source).toBe("/:path*");
    expect(
      Object.fromEntries(rule.headers.map((h) => [h.key, h.value])),
    ).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Permitted-Cross-Domain-Policies": "none",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });
});
describe("page session guard", () => {
  it("redirects signed-out visitors to sign-in", async () => {
    mocks.session = null;
    await expect(requireSession()).rejects.toMatchObject({ to: "/sign-in" });
  });
  it("404s malformed workspace ids without querying", async () => {
    await expect(workspacePage("not-a-uuid")).rejects.toThrow("NOT_FOUND");
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });
  it("404s inaccessible workspaces but surfaces other failures", async () => {
    mocks.getWorkspace.mockRejectedValueOnce(new AppError(404, "x"));
    await expect(workspacePage(ws)).rejects.toThrow("NOT_FOUND");
    mocks.getWorkspace.mockRejectedValueOnce(new Error("database down"));
    await expect(workspacePage(ws)).rejects.toThrow("database down");
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { id: ws } });
    expect(await workspacePage(ws)).toMatchObject({
      session: { user: { id: "user-1" } },
      workspace: { id: ws },
    });
    expect(mocks.getWorkspace).toHaveBeenLastCalledWith("user-1", ws);
  });
});
describe("route handlers", () => {
  const params = <T>(value: T) => ({ params: Promise.resolve(value) });
  const uploadRequest = (name: string) =>
    new Request(origin + "/upload", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/octet-stream",
        "x-file-name": name,
        "x-file-type": "text/plain",
      },
      body: "hello",
    });
  it("upload decodes the filename and passes the raw bytes and claimed type", async () => {
    const response = await upload(
      uploadRequest(encodeURIComponent("Client brief ₹.txt")),
      params({ workspaceId: ws, sourceId: other }),
    );
    expect(await response.json()).toEqual({ id: "doc-1", status: "queued" });
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      "user-1",
      ws,
      other,
      "Client brief ₹.txt",
      "text/plain",
      Buffer.from("hello"),
    );
  });
  it("upload rejects malformed percent-encoding and invalid ids before storing", async () => {
    const broken = await upload(
      uploadRequest("%E0%A4%A"),
      params({ workspaceId: ws, sourceId: other }),
    );
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: "Invalid filename." });
    const badId = await upload(
      uploadRequest("a.txt"),
      params({ workspaceId: "x", sourceId: other }),
    );
    expect(badId.status).toBe(400);
    expect(mocks.uploadDocument).not.toHaveBeenCalled();
  });
  it("member removal passes only the validated target; extra fields are refused", async () => {
    const send = (payload: unknown) =>
      removeRoute(
        new Request(origin, {
          method: "DELETE",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        params({ workspaceId: ws }),
      );
    expect(await (await send({ userId: "u2" })).json()).toEqual({
      removed: true,
    });
    expect(mocks.removeMember).toHaveBeenCalledWith("user-1", ws, "u2");
    expect((await send({ userId: "u2", role: "owner" })).status).toBe(400);
    expect(mocks.removeMember).toHaveBeenCalledTimes(1);
  });
  it("decisions require valid workspace and approval ids", async () => {
    const response = await decide(
      new Request(origin, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject" }),
      }),
      params({ workspaceId: ws, approvalId: "../../etc" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });
  it("run processing passes the validated ids and the session user", async () => {
    await processRoute(
      new Request(origin, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      }),
      params({ workspaceId: ws, runId: other }),
    );
    expect(mocks.processRun).toHaveBeenCalledWith("user-1", ws, other);
  });
});
