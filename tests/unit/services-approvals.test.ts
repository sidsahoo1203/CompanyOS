import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, role, pgError, type Handler } from "./support/fake-db";
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({
  asActor: vi.fn(async (_u: string, _w: string, op: (db: unknown) => unknown) =>
    op(state.client),
  ),
}));
import {
  listApprovals,
  requestApproval,
  getApproval,
  editApproval,
  decideApproval,
} from "@/lib/approvals";
const ws = "11111111-1111-4111-8111-111111111111";
const id = "55555555-5555-4555-8555-555555555555";
const digest = "a".repeat(64);
const approve = {
  decision: "approve",
  digest,
  idempotencyKey: randomUUID(),
  confirmed: true,
};
function script(handlers: Handler[]) {
  const fake = fakeClient(handlers);
  state.client = fake.client;
  return fake;
}
const request = (over: Record<string, unknown> = {}) => ({
  id,
  run_id: "r1",
  proposal_index: 0,
  revision: 1,
  kind: "send_message",
  target: "client@example.test",
  payload: "Hello",
  status: "pending",
  requested_by: "requester",
  requester_active: true,
  authored_by: "requester",
  digest,
  ...over,
});
function detail(
  viewerRole: string,
  over: Record<string, unknown> = {},
  revisions = [{ id, revision: 1 }],
) {
  return script([
    role(viewerRole),
    ["app.expire_approvals", []],
    ["AND a.id=$2", [request(over)]],
    ["a.revision,a.status,a.created_at", revisions],
    ["FROM app.action_execution e", []],
    ["FROM app.audit_event ev", [{ action: "approval.requested" }]],
  ]);
}
describe("decision gate (defense in depth)", () => {
  it("a forged 'executed' result for a member is refused, which rolls the transaction back", async () => {
    script([
      role("member"),
      [
        "app.decide_approval",
        [{ decision_outcome: "executed", decision_execution: "e1" }],
      ],
      ["SELECT digest FROM app.action_execution", [{ digest }]],
    ]);
    await expect(decideApproval("u1", ws, id, approve)).rejects.toMatchObject({
      status: 403,
      message: "Execution was refused by policy.",
    });
  });
  it("an execution recorded under a different digest than the one reviewed is refused", async () => {
    script([
      role("owner"),
      [
        "app.decide_approval",
        [{ decision_outcome: "executed", decision_execution: "e1" }],
      ],
      ["SELECT digest FROM app.action_execution", [{ digest: "b".repeat(64) }]],
    ]);
    await expect(decideApproval("u1", ws, id, approve)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("a genuine approval returns the execution and passes the exact inputs to SQL", async () => {
    const { calls } = script([
      role("admin"),
      [
        "app.decide_approval",
        [{ decision_outcome: "executed", decision_execution: "e1" }],
      ],
      ["SELECT digest FROM app.action_execution", [{ digest }]],
    ]);
    expect(await decideApproval("u1", ws, id, approve)).toEqual({
      outcome: "executed",
      executionId: "e1",
    });
    expect(
      calls.find((c) => c.sql.includes("decide_approval"))?.params,
    ).toEqual([ws, id, "approve", digest, approve.idempotencyKey, ""]);
  });
  it("rejections pass through without touching executions", async () => {
    const { calls } = script([
      role("admin"),
      [
        "app.decide_approval",
        [{ decision_outcome: "rejected", decision_execution: null }],
      ],
    ]);
    expect(
      await decideApproval("u1", ws, id, {
        decision: "reject",
        digest,
        idempotencyKey: randomUUID(),
        note: "  Not now  ",
      }),
    ).toEqual({ outcome: "rejected", executionId: null });
    expect(
      calls.find((c) => c.sql.includes("decide_approval"))?.params[5],
    ).toBe("Not now");
    expect(calls.some((c) => c.sql.includes("SELECT digest"))).toBe(false);
  });
  it.each([
    ["forbidden", 403],
    ["self_approval", 403],
    ["stale", 409],
    ["closed", 409],
    ["replay", 409],
    ["expired", 409],
    ["skill_disabled", 409],
    ["invalid_target", 422],
    ["unsafe_content", 422],
    ["rate_limited", 429],
    ["something_new", 409],
  ])(
    "database outcome %s becomes HTTP %i after the audit commits",
    async (outcome, status) => {
      script([
        role("admin"),
        [
          "app.decide_approval",
          [{ decision_outcome: outcome, decision_execution: null }],
        ],
      ]);
      await expect(decideApproval("u1", ws, id, approve)).rejects.toMatchObject(
        {
          status,
          outcome,
        },
      );
    },
  );
  it("malformed decisions never reach the database", async () => {
    const { calls } = script([]);
    for (const value of [
      { ...approve, confirmed: false },
      { ...approve, digest: "short" },
      { ...approve, executionAllowed: true },
      { decision: "execute", digest, idempotencyKey: randomUUID() },
    ])
      await expect(decideApproval("u1", ws, id, value)).rejects.toMatchObject({
        name: "ZodError",
      });
    expect(calls).toEqual([]);
  });
  it.each([
    ["P0002", 404],
    ["54000", 429],
    ["23505", 409],
  ])("database error %s is translated to %i", async (code, status) => {
    script([role("admin"), ["app.decide_approval", pgError(code)]]);
    await expect(decideApproval("u1", ws, id, approve)).rejects.toMatchObject({
      status,
    });
  });
});
describe("requests and edits", () => {
  it("request creation validates input synchronously and returns the id", async () => {
    expect(() =>
      requestApproval("u1", ws, { runId: "not-a-uuid", proposalIndex: 0 }),
    ).toThrow();
    expect(() =>
      requestApproval("u1", ws, { runId: randomUUID(), proposalIndex: 3 }),
    ).toThrow();
    const { calls } = script([
      role("member"),
      ["app.request_approval", [{ id }]],
    ]);
    const runId = randomUUID();
    expect(await requestApproval("u1", ws, { runId, proposalIndex: 0 })).toBe(
      id,
    );
    expect(calls.at(-1)?.params).toEqual([ws, runId, 0]);
  });
  it("edits trim the recipient, send the reviewed digest and map refusals", async () => {
    const { calls } = script([
      role("member"),
      ["app.edit_approval", [{ edit_outcome: "edited", edit_id: "new" }]],
    ]);
    expect(
      await editApproval("u1", ws, id, {
        digest,
        target: " a@b.example ",
        payload: "New text",
      }),
    ).toEqual({ id: "new" });
    expect(calls.at(-1)?.params).toEqual([
      ws,
      id,
      digest,
      "a@b.example",
      "New text",
    ]);
    script([
      role("member"),
      ["app.edit_approval", [{ edit_outcome: "stale", edit_id: null }]],
    ]);
    await expect(
      editApproval("u1", ws, id, {
        digest,
        target: "a@b.example",
        payload: "x",
      }),
    ).rejects.toMatchObject({ status: 409, outcome: "stale" });
  });
  it("edits reject several recipients or hidden characters before SQL", async () => {
    const { calls } = script([]);
    for (const value of [
      { digest, target: "a@b.example, c@d.example", payload: "x" },
      {
        digest,
        target: "a@b.example",
        payload: "x" + String.fromCodePoint(0x202e),
      },
      { digest, target: "a@b.example", payload: "x", approved: true },
    ])
      await expect(editApproval("u1", ws, id, value)).rejects.toMatchObject({
        name: "ZodError",
      });
    expect(calls).toEqual([]);
  });
});
describe("detail view flags", () => {
  it("approvers see the audit trail and may decide a pending request written by someone else", async () => {
    const { calls } = detail("admin");
    const view = await getApproval("admin-user", ws, id);
    expect(view.viewer).toEqual({
      role: "admin",
      canDecide: true,
      canEdit: true,
      selfAuthored: false,
    });
    expect(view.audit).toEqual([{ action: "approval.requested" }]);
    expect(calls.find((c) => c.sql.includes("audit_event"))?.params[1]).toEqual(
      [id],
    );
  });
  it("members never query the audit log and cannot decide", async () => {
    const { calls } = detail("member");
    const view = await getApproval("requester", ws, id);
    expect(view.viewer).toMatchObject({ canDecide: false, canEdit: true });
    expect(view.audit).toEqual([]);
    expect(calls.some((c) => c.sql.includes("audit_event"))).toBe(false);
  });
  it("authors are flagged as self-authored unless they are the owner", async () => {
    detail("admin", { authored_by: "me" });
    expect((await getApproval("me", ws, id)).viewer.selfAuthored).toBe(true);
    detail("owner", { authored_by: "me" });
    expect((await getApproval("me", ws, id)).viewer.selfAuthored).toBe(false);
  });
  it("decided, superseded or older revisions cannot be decided or edited", async () => {
    detail("owner", { status: "executed" });
    expect((await getApproval("o", ws, id)).viewer).toMatchObject({
      canDecide: false,
      canEdit: false,
    });
    detail("owner", {}, [
      { id, revision: 1 },
      { id: "newer", revision: 2 },
    ]);
    expect((await getApproval("o", ws, id)).viewer.canEdit).toBe(false);
    detail("owner", { status: "expired" });
    expect((await getApproval("o", ws, id)).viewer).toMatchObject({
      canDecide: false,
      canEdit: true,
    });
  });
  it("requests from people who left the workspace cannot be edited", async () => {
    detail("owner", { status: "expired", requester_active: false });
    expect((await getApproval("o", ws, id)).viewer.canEdit).toBe(false);
  });
  it("members who are not the requester cannot edit", async () => {
    detail("member");
    expect((await getApproval("someone-else", ws, id)).viewer.canEdit).toBe(
      false,
    );
  });
  it("flags invalid recipients and hidden characters for the UI", async () => {
    detail("owner", {
      target: "Recipient must be selected by a human",
      payload: "Hi" + String.fromCodePoint(0x200b),
    });
    expect((await getApproval("o", ws, id)).checks).toEqual({
      recipientValid: false,
      contentSafe: false,
    });
  });
  it("hidden requests are 404 and the inbox reports the decide permission", async () => {
    script([role("member"), ["app.expire_approvals", []], ["AND a.id=$2", []]]);
    await expect(getApproval("u", ws, id)).rejects.toMatchObject({
      status: 404,
    });
    script([
      role("member"),
      ["app.expire_approvals", []],
      ["NOT EXISTS(SELECT 1 FROM app.approval_request n", [{ id }]],
    ]);
    expect(await listApprovals("u", ws)).toEqual({
      approvals: [{ id }],
      canDecide: false,
    });
  });
});
