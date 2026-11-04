import { afterEach, describe, expect, it, vi } from "vitest";
// Every route handler: ids are validated, the body schema is enforced, and the
// right service receives the session user and parsed values in the right order.
const services = vi.hoisted(() => {
  const names = [
    "listWorkspaces",
    "createWorkspace",
    "getWorkspace",
    "updateWorkspace",
    "inviteMember",
    "acceptInvitation",
    "changeMemberRole",
    "removeMember",
    "listKnowledge",
    "saveSource",
    "uploadDocument",
    "authorizeUpload",
    "processDocument",
    "getDocument",
    "retrieve",
    "answerQuestion",
    "listAutomation",
    "publishProcedure",
    "createSkill",
    "toggleSkill",
    "createRun",
    "getRun",
    "processRun",
    "listApprovals",
    "requestApproval",
    "getApproval",
    "editApproval",
    "decideApproval",
  ];
  return Object.fromEntries(
    names.map((name) => [name, vi.fn(async () => "result")]),
  );
});
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession: async () => ({ user: { id: "user-1" } }) },
  }),
}));
vi.mock("@/lib/workspaces", () => services);
vi.mock("@/lib/knowledge", () => services);
vi.mock("@/lib/agents", () => services);
vi.mock("@/lib/approvals", () => services);
const ws = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const uuid = "33333333-3333-4333-8333-333333333333";
const origin = "http://127.0.0.1:3000";
const workspace = {
  name: "Agency",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en",
  retentionDays: 90,
};
const source = {
  title: "Handbook",
  description: "",
  tags: [],
  scope: "workspace",
  archived: false,
};
const procedure = {
  procedureId: null,
  title: "SOP",
  instructions: "Do it carefully.",
  sourceIds: [uuid],
};
const skill = {
  name: "Skill",
  versionId: uuid,
  operation: "source_brief",
  maxTokens: 8000,
  maxCostMicrousd: 0,
  timeoutMs: 10000,
};
const run = {
  skillId: uuid,
  requestKey: uuid,
  input: { objective: "Go", context: "", target: "" },
};
const edit = { digest: "a".repeat(64), target: "a@b.example", payload: "Hi" };
const W = "@/app/api/workspaces";
type Case = {
  route: string;
  method: "GET" | "POST" | "PATCH";
  params: Record<string, string>;
  body?: unknown;
  service: string;
  args: unknown[];
};
const cases: Case[] = [
  {
    route: W + "/route",
    method: "GET",
    params: {},
    service: "listWorkspaces",
    args: ["user-1"],
  },
  {
    route: W + "/route",
    method: "POST",
    params: {},
    body: workspace,
    service: "createWorkspace",
    args: ["user-1", workspace],
  },
  {
    route: W + "/[workspaceId]/route",
    method: "GET",
    params: { workspaceId: ws },
    service: "getWorkspace",
    args: ["user-1", ws],
  },
  {
    route: W + "/[workspaceId]/route",
    method: "PATCH",
    params: { workspaceId: ws },
    body: workspace,
    service: "updateWorkspace",
    args: ["user-1", ws, workspace],
  },
  {
    route: W + "/[workspaceId]/invitations/route",
    method: "POST",
    params: { workspaceId: ws },
    body: { email: "New@B.example", role: "member" },
    service: "inviteMember",
    args: ["user-1", ws, "new@b.example", "member"],
  },
  {
    route: "@/app/api/invitations/accept/route",
    method: "POST",
    params: {},
    body: { token: "a".repeat(64) },
    service: "acceptInvitation",
    args: ["user-1", "a".repeat(64)],
  },
  {
    route: W + "/[workspaceId]/members/route",
    method: "PATCH",
    params: { workspaceId: ws },
    body: { userId: "u2", role: "admin" },
    service: "changeMemberRole",
    args: ["user-1", ws, "u2", "admin"],
  },
  {
    route: W + "/[workspaceId]/knowledge/route",
    method: "GET",
    params: { workspaceId: ws },
    service: "listKnowledge",
    args: ["user-1", ws],
  },
  {
    route: W + "/[workspaceId]/knowledge/route",
    method: "POST",
    params: { workspaceId: ws },
    body: source,
    service: "saveSource",
    args: ["user-1", ws, null, source],
  },
  {
    route: W + "/[workspaceId]/knowledge/[sourceId]/route",
    method: "PATCH",
    params: { workspaceId: ws, sourceId: id },
    body: source,
    service: "saveSource",
    args: ["user-1", ws, id, source],
  },
  {
    route: W + "/[workspaceId]/knowledge/search/route",
    method: "POST",
    params: { workspaceId: ws },
    body: { question: "kickoff" },
    service: "retrieve",
    args: ["user-1", ws, "kickoff"],
  },
  {
    route: W + "/[workspaceId]/assistant/route",
    method: "POST",
    params: { workspaceId: ws },
    body: { question: "kickoff" },
    service: "answerQuestion",
    args: ["user-1", ws, "kickoff"],
  },
  {
    route: W + "/[workspaceId]/documents/[documentId]/route",
    method: "GET",
    params: { workspaceId: ws, documentId: id },
    service: "getDocument",
    args: ["user-1", ws, id],
  },
  {
    route: W + "/[workspaceId]/documents/[documentId]/process/route",
    method: "POST",
    params: { workspaceId: ws, documentId: id },
    body: {},
    service: "processDocument",
    args: ["user-1", ws, id],
  },
  {
    route: W + "/[workspaceId]/procedures/route",
    method: "GET",
    params: { workspaceId: ws },
    service: "listAutomation",
    args: ["user-1", ws],
  },
  {
    route: W + "/[workspaceId]/procedures/route",
    method: "POST",
    params: { workspaceId: ws },
    body: procedure,
    service: "publishProcedure",
    args: ["user-1", ws, procedure],
  },
  {
    route: W + "/[workspaceId]/skills/route",
    method: "POST",
    params: { workspaceId: ws },
    body: skill,
    service: "createSkill",
    args: ["user-1", ws, skill],
  },
  {
    route: W + "/[workspaceId]/skills/[skillId]/route",
    method: "PATCH",
    params: { workspaceId: ws, skillId: id },
    body: { enabled: false },
    service: "toggleSkill",
    args: ["user-1", ws, id, false],
  },
  {
    route: W + "/[workspaceId]/runs/route",
    method: "POST",
    params: { workspaceId: ws },
    body: run,
    service: "createRun",
    args: ["user-1", ws, run],
  },
  {
    route: W + "/[workspaceId]/runs/[runId]/route",
    method: "GET",
    params: { workspaceId: ws, runId: id },
    service: "getRun",
    args: ["user-1", ws, id],
  },
  {
    route: W + "/[workspaceId]/approvals/route",
    method: "GET",
    params: { workspaceId: ws },
    service: "listApprovals",
    args: ["user-1", ws],
  },
  {
    route: W + "/[workspaceId]/approvals/route",
    method: "POST",
    params: { workspaceId: ws },
    body: { runId: uuid, proposalIndex: 0 },
    service: "requestApproval",
    args: ["user-1", ws, { runId: uuid, proposalIndex: 0 }],
  },
  {
    route: W + "/[workspaceId]/approvals/[approvalId]/route",
    method: "GET",
    params: { workspaceId: ws, approvalId: id },
    service: "getApproval",
    args: ["user-1", ws, id],
  },
  {
    route: W + "/[workspaceId]/approvals/[approvalId]/revisions/route",
    method: "POST",
    params: { workspaceId: ws, approvalId: id },
    body: edit,
    service: "editApproval",
    args: ["user-1", ws, id, edit],
  },
];
async function call(c: Case, params = c.params, payload = c.body) {
  const module = await import(/* @vite-ignore */ c.route);
  const request = new Request(origin + "/api", {
    method: c.method,
    headers: { origin, "content-type": "application/json" },
    body: c.method === "GET" ? undefined : JSON.stringify(payload ?? {}),
  });
  return module[c.method](request, {
    params: Promise.resolve(params),
  }) as Promise<Response>;
}
afterEach(() => vi.clearAllMocks());
describe("route handlers", () => {
  it.each(
    cases.map(
      (c) =>
        [
          c.method + " " + c.route.replace(W, "").replace("/route", ""),
          c,
        ] as const,
    ),
  )(
    "%s passes the session user and validated values to its service",
    async (_, c) => {
      const response = await call(c);
      expect(response.status).toBe(200);
      expect(services[c.service]).toHaveBeenCalledWith(...c.args);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it.each(
    cases
      .filter((c) => Object.keys(c.params).length)
      .map(
        (c) =>
          [
            c.method + " " + c.route.replace(W, "").replace("/route", ""),
            c,
          ] as const,
      ),
  )("%s rejects a malformed id before calling the service", async (_, c) => {
    const key = Object.keys(c.params).at(-1)!;
    const response = await call(c, { ...c.params, [key]: "../../not-a-uuid" });
    expect(response.status).toBe(400);
    expect(services[c.service]).not.toHaveBeenCalled();
  });
  it.each(
    cases
      .filter((c) => c.body && Object.keys(c.body as object).length)
      .map(
        (c) =>
          [
            c.method + " " + c.route.replace(W, "").replace("/route", ""),
            c,
          ] as const,
      ),
  )("%s rejects smuggled fields in the body", async (_, c) => {
    const response = await call(c, c.params, {
      ...(c.body as object),
      role: "owner",
      userIdOverride: "x",
    });
    expect(response.status).toBe(400);
    expect(services[c.service]).not.toHaveBeenCalled();
  });
});
