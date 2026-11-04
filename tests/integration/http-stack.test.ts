import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authPool, tenantPool } from "@/lib/db";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import {
  GET as listWorkspaces,
  POST as createWorkspace,
} from "@/app/api/workspaces/route";
import {
  GET as getWorkspace,
  PATCH as patchWorkspace,
} from "@/app/api/workspaces/[workspaceId]/route";
import { POST as createSource } from "@/app/api/workspaces/[workspaceId]/knowledge/route";
// Real requests through the auth route, Better Auth, the api() guard, the
// services and PostgreSQL; only the network socket is skipped.
const origin = new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000")
  .origin;
const password = "Integration-Test-" + randomUUID();
const workspace = {
  name: "HTTP stack",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en",
  retentionDays: 90,
};
const emailFor = (label: string) =>
  label + "-" + randomUUID() + "@http-stack.example";
function request(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + path, {
    method,
    headers: { origin, "content-type": "application/json", ...headers },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
// The sign-up/sign-in limit is a shared 10/minute local bucket; wait it out once.
async function auth(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await authPost(
      request("/api/auth/" + path, "POST", body, headers),
    );
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("x-retry-after") ?? "60");
    await new Promise((resolve) =>
      setTimeout(resolve, (Math.min(wait, 65) + 1) * 1000),
    );
  }
  throw new Error("Auth stayed rate limited.");
}
async function signUp(label: string, extra: Record<string, unknown> = {}) {
  const email = emailFor(label);
  const response = await auth("sign-up/email", {
    name: label,
    email,
    password,
    ...extra,
  });
  return { response, email, cookie: cookieOf(response) };
}
const context = (workspaceId?: string) => ({
  params: Promise.resolve({ workspaceId: workspaceId ?? "" }),
});
let alice: { email: string; cookie: string };
let bob: { email: string; cookie: string };
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/companyos_test")
    throw new Error("Local isolated test DB required.");
  alice = await signUp("alice");
  bob = await signUp("bob");
}, 180000);
afterAll(async () => {
  await authPool().end();
  await tenantPool().end();
});
describe("accounts and sessions", () => {
  it("sign-up stores a salted hash, never the password, and returns a working session", async () => {
    const row = (
      await authPool().query(
        'SELECT a.password FROM public.account a JOIN public."user" u ON u.id=a."userId" WHERE u.email=$1',
        [alice.email],
      )
    ).rows[0];
    expect(row.password).not.toContain(password);
    expect(row.password.length).toBeGreaterThan(60);
    const response = await listWorkspaces(
      request("/api/workspaces", "GET", undefined, { cookie: alice.cookie }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [] });
  });
  it("protected routes refuse missing and tampered session cookies", async () => {
    expect(
      (await listWorkspaces(request("/api/workspaces", "GET"))).status,
    ).toBe(401);
    const tampered = alice.cookie.replace(/=([^.;]+)/, "=AAAA$1");
    expect(
      (
        await listWorkspaces(
          request("/api/workspaces", "GET", undefined, { cookie: tampered }),
        )
      ).status,
    ).toBe(401);
  });
  it("sign-up ignores privileged fields supplied by the client", async () => {
    const chosenId = "attacker-" + randomUUID();
    const { response, email } = await signUp("mallory", {
      emailVerified: true,
      id: chosenId,
      role: "owner",
      createdAt: "2000-01-01T00:00:00Z",
    });
    expect(response.status).toBe(200);
    const row = (
      await authPool().query(
        'SELECT id,"emailVerified","createdAt" FROM public."user" WHERE email=$1',
        [email],
      )
    ).rows[0];
    expect(row.emailVerified).toBe(false);
    expect(row.id).not.toBe(chosenId);
    expect(new Date(row.createdAt).getFullYear()).toBeGreaterThan(2020);
  });
  it("an email cannot be registered twice, regardless of letter case", async () => {
    const response = await auth("sign-up/email", {
      name: "Dup",
      email: alice.email.toUpperCase(),
      password,
    });
    expect(response.status).not.toBe(200);
    const count = (
      await authPool().query(
        'SELECT count(*) FROM public."user" WHERE lower(email)=lower($1)',
        [alice.email],
      )
    ).rows[0].count;
    expect(Number(count)).toBe(1);
  });
  it("a wrong password and an unknown account fail identically", async () => {
    const wrong = await auth("sign-in/email", {
      email: alice.email,
      password: "Wrong-password-123",
    });
    const unknown = await auth("sign-in/email", {
      email: emailFor("nobody"),
      password: "Wrong-password-123",
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
    expect(cookieOf(wrong)).not.toContain("session_token=");
  });
  it("sign-out deletes the session so the old cookie stops working", async () => {
    const signIn = await auth("sign-in/email", { email: bob.email, password });
    const cookie = cookieOf(signIn);
    expect(
      (
        await listWorkspaces(
          request("/api/workspaces", "GET", undefined, { cookie }),
        )
      ).status,
    ).toBe(200);
    const out = await auth("sign-out", {}, { cookie });
    expect(out.status).toBe(200);
    expect(
      (
        await listWorkspaces(
          request("/api/workspaces", "GET", undefined, { cookie }),
        )
      ).status,
    ).toBe(401);
  });
});
describe("protected API over real sessions", () => {
  it("creates a workspace, then isolates it from another account", async () => {
    const created = await createWorkspace(
      request("/api/workspaces", "POST", workspace, { cookie: alice.cookie }),
    );
    expect(created.status).toBe(200);
    const { id } = await created.json();
    expect(
      (
        await getWorkspace(
          request("/x", "GET", undefined, { cookie: alice.cookie }),
          context(id),
        )
      ).status,
    ).toBe(200);
    const foreign = await getWorkspace(
      request("/x", "GET", undefined, { cookie: bob.cookie }),
      context(id),
    );
    expect(foreign.status).toBe(404);
    const write = await patchWorkspace(
      request(
        "/x",
        "PATCH",
        { ...workspace, name: "Hijacked" },
        { cookie: bob.cookie },
      ),
      context(id),
    );
    expect(write.status).toBe(404);
    const after = await getWorkspace(
      request("/x", "GET", undefined, { cookie: alice.cookie }),
      context(id),
    );
    expect((await after.json()).workspace.name).toBe("HTTP stack");
  });
  it("refuses cross-site, malformed and oversized writes with the right statuses", async () => {
    const created = await createWorkspace(
      request("/api/workspaces", "POST", workspace, { cookie: alice.cookie }),
    );
    const { id } = await created.json();
    const source = {
      title: "Handbook",
      description: "",
      tags: [],
      scope: "workspace",
      archived: false,
    };
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      createSource(
        request("/x", "POST", body, { cookie: alice.cookie, ...headers }),
        context(id),
      );
    expect(
      (await send(source, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(
      (await send(source, { "sec-fetch-site": "cross-site" })).status,
    ).toBe(403);
    expect((await send(source, { "content-type": "text/plain" })).status).toBe(
      415,
    );
    expect((await send("{broken")).status).toBe(400);
    expect(
      (
        await send({
          ...source,
          title: "Bad" + String.fromCharCode(0) + "title",
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ ...source, description: "x".repeat(20000) })).status,
    ).toBe(413);
    expect((await send({ ...source, owner_id: "someone-else" })).status).toBe(
      400,
    );
    const ok = await send(source);
    expect(ok.status).toBe(200);
    expect((await ok.json()).id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("unexpected database failures return a reference, not internals", async () => {
    const response = await createWorkspace(
      request(
        "/api/workspaces",
        "POST",
        { ...workspace, timezone: "Not/AZone" },
        { cookie: alice.cookie },
      ),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/pg_timezone_names|plpgsql|SQL/);
  });
});
describe("password changes", () => {
  it("changing the password ends every other session, even if the client does not ask", async () => {
    const carol = await signUp("carol");
    const laptop = cookieOf(
      await auth("sign-in/email", { email: carol.email, password }),
    );
    const phone = cookieOf(
      await auth("sign-in/email", { email: carol.email, password }),
    );
    const changed = await auth(
      "change-password",
      {
        currentPassword: password,
        newPassword: password + "-rotated",
        revokeOtherSessions: false,
      },
      { cookie: laptop },
    );
    expect(changed.status).toBe(200);
    const read = (cookie: string) =>
      listWorkspaces(request("/api/workspaces", "GET", undefined, { cookie }));
    expect((await read(phone)).status).toBe(401);
    expect((await read(carol.cookie)).status).toBe(401);
    // The device that changed the password receives a fresh session.
    expect((await read(cookieOf(changed))).status).toBe(200);
  });
});
