// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeFetch } from "./support/fake-fetch";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href, ...rest }, children),
  };
});
import { ApprovalDetail } from "@/components/approval-detail";
import { ApprovalInbox } from "@/components/approval-inbox";
const base = "/api/workspaces/ws/approvals";
const digest = "d".repeat(64);
const when = "2026-10-20T10:00:00Z";
const citation = {
  documentId: "doc1",
  sourceId: "s1",
  title: "Handbook",
  filename: "a.txt",
  version: 1,
  chunk: 1,
  location: "Document text",
  quote: "Welcome messages confirm the scope.",
  href: "/w/ws/knowledge/documents/doc1#chunk-1",
};
function detail(
  over: {
    request?: Record<string, unknown>;
    viewer?: Record<string, unknown>;
    checks?: Record<string, unknown>;
    execution?: unknown;
    audit?: unknown[];
  } = {},
) {
  return {
    request: {
      id: "a1",
      run_id: "r1",
      proposal_index: 0,
      revision: 2,
      kind: "send_message",
      target: "client@example.test",
      status: "pending",
      requested_by: "u-req",
      requester_name: "Riya",
      requester_email: "riya@agency.example",
      authored_by: "u-adm",
      author_name: "Workspace Owner",
      author_email: "admin@agency.example",
      created_at: when,
      expires_at: when,
      decided_at: null,
      decider_name: null,
      decider_email: null,
      payload: "Hello <b>team</b>\nKickoff is Monday.",
      inputs: {
        objective: "Welcome Northwind",
        context: "",
        target: "client@example.test",
      },
      sources: [citation],
      expected_effect:
        "Records this exact message for client@example.test in the CompanyOS local outbox on this computer. Nothing is emailed or sent to any external service.",
      digest,
      supersedes: "a0",
      decision_note: null,
      ...over.request,
    },
    revisions: [
      {
        id: "a0",
        revision: 1,
        status: "superseded",
        created_at: when,
        author_name: "Riya",
        author_email: "riya@agency.example",
      },
      {
        id: "a1",
        revision: 2,
        status: "pending",
        created_at: when,
        author_name: "Workspace Owner",
        author_email: "admin@agency.example",
      },
    ],
    execution: over.execution ?? null,
    audit: over.audit ?? [
      {
        action: "approval.denied",
        result: "denied",
        created_at: when,
        actor_name: "Mem",
        actor_email: "mem@agency.example",
        reason: "forbidden",
      },
    ],
    viewer: {
      role: "owner",
      canDecide: true,
      canEdit: true,
      selfAuthored: false,
      ...over.viewer,
    },
    checks: { recipientValid: true, contentSafe: true, ...over.checks },
  };
}
const confirmBox = () =>
  screen.getByLabelText(
    "I reviewed the exact recipient, content, inputs, sources and expected effect.",
  );
const approveButton = () =>
  screen.getByRole("button", {
    name: "Approve and record in local outbox",
  }) as HTMLButtonElement;
function mount(data = detail(), extra: Parameters<typeof fakeFetch>[0] = {}) {
  const fake = fakeFetch({ ["GET " + base + "/a1"]: { body: data }, ...extra });
  render(<ApprovalDetail workspaceId="ws" approvalId="a1" />);
  return fake;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("ApprovalDetail: what the reviewer sees", () => {
  it("shows the exact recipient, content as text, expected effect, fingerprint, inputs and sources", async () => {
    mount();
    const box = (
      await screen.findByRole("heading", { name: "Exact action to review" })
    ).parentElement!;
    expect(
      within(box).getByText("client@example.test", { selector: "strong" }),
    ).toBeTruthy();
    const content = box.querySelector("pre.approval-content")!;
    expect(content.textContent).toBe("Hello <b>team</b>\nKickoff is Monday.");
    expect(content.querySelector("b")).toBeNull();
    expect(within(box).getByText(/Nothing is emailed or sent/)).toBeTruthy();
    expect(within(box).getByText(digest)).toBeTruthy();
    expect(within(box).getByText("Welcome Northwind")).toBeTruthy();
    expect(within(box).getByText("None")).toBeTruthy();
    expect(
      within(box).getByText("Welcome messages confirm the scope."),
    ).toBeTruthy();
  });
  it("identifies people by name and immutable email", async () => {
    mount();
    expect(
      await screen.findByText(
        "2 of 2 · written by Workspace Owner (admin@agency.example)",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Riya (riya@agency.example)")).toBeTruthy();
    expect(screen.getByText(/Mem \(mem@agency\.example\)/)).toBeTruthy();
  });
  it("shows the status as the single live region and labels the audit trail", async () => {
    mount();
    await screen.findByText("Status: Waiting for decision");
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toEqual([
      "Status: Waiting for decision",
    ]);
    const audit = screen.getByRole("heading", {
      name: "Audit trail",
    }).parentElement!;
    expect(within(audit).getByText("Attempt refused")).toBeTruthy();
    expect(within(audit).getByText(/reason: forbidden/)).toBeTruthy();
  });
  it("links other revisions and marks the current one", async () => {
    mount();
    const history = (
      await screen.findByRole("heading", { name: "Revision history" })
    ).parentElement!;
    expect(
      within(history)
        .getByRole("link", { name: "Revision 1" })
        .getAttribute("href"),
    ).toBe("/w/ws/approvals/a0");
    expect(within(history).getByText("Revision 2 (this page)")).toBeTruthy();
  });
});
describe("ApprovalDetail: decisions", () => {
  it("approve stays disabled until the reviewer confirms, then sends digest, key and confirmation", async () => {
    const { sent } = mount(detail(), {
      ["POST " + base + "/a1/decision"]: { body: { outcome: "executed" } },
    });
    await screen.findByText("Status: Waiting for decision");
    expect(approveButton().disabled).toBe(true);
    await userEvent.click(confirmBox());
    expect(approveButton().disabled).toBe(false);
    await userEvent.type(
      screen.getByLabelText("Decision note (optional)"),
      "Looks right",
    );
    await userEvent.click(approveButton());
    expect(await screen.findByText(/nothing was sent externally/)).toBeTruthy();
    const decision = sent.find((s) => s.method === "POST")!.body as Record<
      string,
      unknown
    >;
    expect(decision).toMatchObject({
      decision: "approve",
      digest,
      note: "Looks right",
      confirmed: true,
    });
    expect(decision.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("a retry after a failed approval reuses the same idempotency key", async () => {
    let attempts = 0;
    const { sent } = mount(detail(), {
      ["POST " + base + "/a1/decision"]: () =>
        ++attempts === 1
          ? { status: 503, body: { error: "Try again." } }
          : { body: { outcome: "executed" } },
    });
    await screen.findByText("Status: Waiting for decision");
    await userEvent.click(confirmBox());
    await userEvent.click(approveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Try again.");
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await userEvent.click(approveButton());
    await screen.findByText(/nothing was sent externally/);
    const keys = sent
      .filter((s) => s.method === "POST")
      .map((s) => (s.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it("reject needs no confirmation and never sends the approval confirmation flag", async () => {
    const { sent } = mount(detail(), {
      ["POST " + base + "/a1/decision"]: { body: { outcome: "rejected" } },
    });
    await userEvent.type(
      await screen.findByLabelText("Decision note (optional)"),
      "Wrong client",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(
      await screen.findByText(/This request can no longer be approved/),
    ).toBeTruthy();
    const decision = sent.find((s) => s.method === "POST")!.body as Record<
      string,
      unknown
    >;
    expect(decision).toMatchObject({
      decision: "reject",
      digest,
      note: "Wrong client",
    });
    expect(decision).not.toHaveProperty("confirmed");
  });
  it.each([
    [
      "self-authored content",
      { viewer: { selfAuthored: true } },
      /You wrote this revision/,
    ],
    [
      "an invalid recipient",
      { checks: { recipientValid: false } },
      /not one valid email address/,
    ],
    [
      "hidden characters",
      { checks: { contentSafe: false } },
      /Hidden or control characters were detected/,
    ],
  ])(
    "approval is impossible for %s, even when confirmed",
    async (_, over, warning) => {
      mount(detail(over as never));
      expect(await screen.findByText(warning)).toBeTruthy();
      await userEvent.click(confirmBox());
      expect(approveButton().disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    },
  );
  it("viewers without decide permission see no decision controls or audit trail", async () => {
    mount(detail({ viewer: { role: "member", canDecide: false }, audit: [] }));
    await screen.findByText("Status: Waiting for decision");
    expect(screen.queryByRole("heading", { name: "Decision" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
  });
});
describe("ApprovalDetail: edits and records", () => {
  it("edits send the reviewed digest and open the new revision", async () => {
    const { sent } = mount(detail(), {
      ["POST " + base + "/a1/revisions"]: { body: { id: "a2" } },
    });
    const user = userEvent.setup();
    const payload = await screen.findByRole("textbox", {
      name: "Message content",
    });
    await user.clear(payload);
    await user.type(payload, "Hello Northwind, welcome aboard.");
    await user.click(
      screen.getByRole("button", { name: "Save as new revision" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/w/ws/approvals/a2"),
    );
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({
      digest,
      target: "client@example.test",
      payload: "Hello Northwind, welcome aboard.",
    });
  });
  it("an invalid recipient is not prefilled into the edit form", async () => {
    mount(
      detail({
        request: { target: "Recipient must be selected by a human" },
        checks: { recipientValid: false },
      }),
    );
    expect(
      ((await screen.findByLabelText("Recipient email")) as HTMLInputElement)
        .value,
    ).toBe("");
  });
  it("executed requests show the decision and local-outbox evidence, with no controls", async () => {
    mount(
      detail({
        request: {
          status: "executed",
          decided_at: when,
          decider_name: "Owner",
          decider_email: "owner@agency.example",
          decision_note: "Approved",
        },
        viewer: { canDecide: false, canEdit: false },
        execution: {
          id: "e1",
          executor: "local-outbox-v1",
          kind: "send_message",
          target: "client@example.test",
          payload: "Hello <b>team</b>",
          digest,
          status: "recorded_locally",
          executed_at: when,
          executor_name: "Owner",
          executor_email: "owner@agency.example",
        },
      }),
    );
    expect(
      await screen.findByText("Status: Approved · recorded in local outbox"),
    ).toBeTruthy();
    const outbox = screen.getByRole("heading", {
      name: "Local outbox record",
    }).parentElement!;
    expect(
      within(outbox).getByText(
        /Recorded locally by local-outbox-v1\. Nothing was emailed/,
      ),
    ).toBeTruthy();
    expect(within(outbox).getByText("e1")).toBeTruthy();
    expect(outbox.querySelector("b")).toBeNull();
    const record = screen.getByRole("heading", {
      name: "Decision record",
    }).parentElement!;
    expect(
      within(record).getByText("Owner (owner@agency.example)"),
    ).toBeTruthy();
    expect(within(record).getByText("Approved")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Edit before approval" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Decision" })).toBeNull();
  });
  it("unavailable requests show an alert", async () => {
    fakeFetch({ ["GET " + base + "/a1"]: { status: 404, body: {} } });
    render(<ApprovalDetail workspaceId="ws" approvalId="a1" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Approval request unavailable",
    );
  });
});
describe("ApprovalInbox", () => {
  const item = (over: Record<string, unknown>) => ({
    id: "a1",
    target: "client@example.test",
    status: "pending",
    revision: 1,
    requester_name: "Riya",
    requester_email: "riya@agency.example",
    expires_at: when,
    created_at: when,
    decided_at: null,
    decider_name: null,
    decider_email: null,
    ...over,
  });
  it("splits waiting and decided requests and labels people with emails", async () => {
    fakeFetch({
      ["GET " + base]: {
        body: {
          canDecide: true,
          approvals: [
            item({}),
            item({
              id: "a2",
              status: "executed",
              decided_at: when,
              decider_name: "Owner",
              decider_email: "owner@agency.example",
            }),
          ],
        },
      },
    });
    render(<ApprovalInbox workspaceId="ws" />);
    const waiting = (
      await screen.findByRole("heading", { name: "Waiting for decision" })
    ).parentElement!;
    const history = screen.getByRole("heading", {
      name: "History",
    }).parentElement!;
    expect(
      within(waiting)
        .getByRole("link", { name: "Send message to client@example.test" })
        .getAttribute("href"),
    ).toBe("/w/ws/approvals/a1");
    expect(
      within(waiting).getByText(/Requested by Riya \(riya@agency\.example\)/),
    ).toBeTruthy();
    expect(
      within(history).getByText(/by Owner \(owner@agency\.example\)/),
    ).toBeTruthy();
    expect(
      within(history).getByText("Approved · recorded in local outbox"),
    ).toBeTruthy();
    expect(screen.getByText(/You can approve or reject requests/)).toBeTruthy();
  });
  it("members see an explanation, empty states, and can refresh", async () => {
    let calls = 0;
    fakeFetch({
      ["GET " + base]: () => {
        calls++;
        return { body: { canDecide: false, approvals: [] } };
      },
    });
    render(<ApprovalInbox workspaceId="ws" />);
    expect(
      await screen.findByText(/You see the approval requests you submitted/),
    ).toBeTruthy();
    expect(screen.getByText(/No approval requests are waiting/)).toBeTruthy();
    expect(
      screen.getByText("No decided or expired requests yet."),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh inbox" }),
    );
    await waitFor(() => expect(calls).toBe(2));
  });
  it("load failures show an alert", async () => {
    fakeFetch({ ["GET " + base]: { status: 500, body: {} } });
    render(<ApprovalInbox workspaceId="ws" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load approvals",
    );
  });
});
