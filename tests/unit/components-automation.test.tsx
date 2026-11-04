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
import { ProceduresPanel } from "@/components/procedures-panel";
import { RunDetail } from "@/components/run-detail";
const base = "/api/workspaces/ws";
const library = {
  versions: [
    {
      id: "v2",
      procedure_id: "p1",
      version: 2,
      title: "Kickoff",
      instructions: "Draft the welcome message.",
      source_ids: ["s1"],
      created_at: "2026-10-02T00:00:00Z",
    },
    {
      id: "v1",
      procedure_id: "p1",
      version: 1,
      title: "Kickoff",
      instructions: "Older instructions.",
      source_ids: ["s1"],
      created_at: "2026-10-01T00:00:00Z",
    },
  ],
  skills: [
    {
      id: "k1",
      version_id: "v1",
      name: "Welcome",
      operation: "message_draft",
      max_tokens: 8000,
      max_cost_microusd: 250000,
      timeout_ms: 10000,
      enabled: true,
    },
    {
      id: "k2",
      version_id: "v1",
      name: "Retired",
      operation: "source_brief",
      max_tokens: 8000,
      max_cost_microusd: 0,
      timeout_ms: 10000,
      enabled: false,
    },
  ],
  runs: [
    {
      id: "r1",
      input: { objective: "Welcome Northwind" },
      status: "draft_ready",
      created_at: "2026-10-03T00:00:00Z",
    },
  ],
};
const sources = {
  sources: [
    { id: "s1", title: "Handbook", scope: "workspace", archived: false },
    { id: "s2", title: "Old notes", scope: "admins", archived: true },
  ],
  documents: [],
};
function mount(
  manage: boolean,
  extra: Parameters<typeof fakeFetch>[0] = {},
  kb = sources,
) {
  const fake = fakeFetch({
    ["GET " + base + "/procedures"]: { body: library },
    ["GET " + base + "/knowledge"]: { body: kb },
    ...extra,
  });
  render(<ProceduresPanel workspaceId="ws" manage={manage} />);
  return fake;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("ProceduresPanel", () => {
  it("announces loading and reports load failures", async () => {
    fakeFetch({
      ["GET " + base + "/procedures"]: { status: 503, body: {} },
      ["GET " + base + "/knowledge"]: { body: sources },
    });
    render(<ProceduresPanel workspaceId="ws" manage />);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading procedures",
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load procedures",
    );
  });
  it("members see no management forms and can only run enabled skills", async () => {
    mount(false);
    expect(
      await screen.findByText(/Only owners and admins publish procedures/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Publish a procedure version" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Disable/ })).toBeNull();
    const options = within(screen.getByLabelText("Agent skill"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Select a skill", "Welcome"]);
  });
  it("publishes a new procedure with only active sources selectable", async () => {
    const { sent } = mount(true, {
      ["POST " + base + "/procedures"]: { body: { id: "v3" } },
    });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Procedure title"),
      "Offboarding",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Procedure instructions" }),
      "Collect access and archive files.",
    );
    expect(screen.queryByLabelText("Old notes (admins)")).toBeNull();
    await user.click(screen.getByLabelText("Handbook (workspace)"));
    await user.click(screen.getByRole("button", { name: "Publish version" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Existing skills stay pinned",
    );
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({
      procedureId: null,
      title: "Offboarding",
      instructions: "Collect access and archive files.",
      sourceIds: ["s1"],
    });
  });
  it("editing prefills the latest version and publishes as the same procedure", async () => {
    const { sent } = mount(true, {
      ["POST " + base + "/procedures"]: { body: { id: "v3" } },
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Procedure"), "p1");
    expect(
      (screen.getByLabelText("Procedure title") as HTMLInputElement).value,
    ).toBe("Kickoff");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Procedure instructions",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Draft the welcome message.");
    expect(
      (screen.getByLabelText("Handbook (workspace)") as HTMLInputElement)
        .checked,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Publish version" }));
    await waitFor(() =>
      expect(sent.some((s) => s.method === "POST")).toBe(true),
    );
    expect(sent.find((s) => s.method === "POST")?.body).toMatchObject({
      procedureId: "p1",
      sourceIds: ["s1"],
    });
  });
  it("publishing is disabled until an active source exists", async () => {
    mount(true, {}, { sources: [{ ...sources.sources[1] }], documents: [] });
    const button = (await screen.findByRole("button", {
      name: "Publish version",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByRole("link", { name: "Knowledge" }).getAttribute("href"),
    ).toBe("/w/ws/knowledge");
  });
  it("skills convert dollars to micro-USD and seconds to milliseconds", async () => {
    const { sent } = mount(true, {
      ["POST " + base + "/skills"]: { body: { id: "k3" } },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Skill name"), "Brief");
    await user.selectOptions(
      screen.getByLabelText("Pinned procedure version"),
      "v1",
    );
    await user.clear(screen.getByLabelText("Cost ceiling (USD)"));
    await user.type(screen.getByLabelText("Cost ceiling (USD)"), "0.25");
    await user.clear(screen.getByLabelText("Timeout (seconds)"));
    await user.type(screen.getByLabelText("Timeout (seconds)"), "5");
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() =>
      expect(sent.some((s) => s.url.endsWith("/skills"))).toBe(true),
    );
    expect(sent.find((s) => s.url.endsWith("/skills"))?.body).toEqual({
      name: "Brief",
      versionId: "v1",
      operation: "source_brief",
      maxTokens: 8000,
      maxCostMicrousd: 250000,
      timeoutMs: 5000,
    });
  });
  it("lists skills with their pinned version and ceiling, and toggles them", async () => {
    const { sent } = mount(true, {
      ["PATCH " + base + "/skills/k1"]: { body: { ok: true } },
    });
    expect(
      await screen.findByText(
        "message_draft · Enabled · 8000 token ceiling · $0.250000 ceiling",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Pinned to Kickoff · v1")).toHaveLength(2);
    await userEvent.click(
      screen.getByRole("button", { name: "Disable Welcome" }),
    );
    await waitFor(() =>
      expect(sent.some((s) => s.method === "PATCH")).toBe(true),
    );
    expect(sent.find((s) => s.method === "PATCH")?.body).toEqual({
      enabled: false,
    });
  });
  it("runs are created with a fresh request key and open their detail page", async () => {
    const { sent } = mount(false, {
      ["POST " + base + "/runs"]: { body: { id: "r9" } },
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Agent skill"), "k1");
    await user.type(screen.getByLabelText("Objective"), "Welcome Contoso");
    await user.type(
      screen.getByLabelText("Proposed recipient (optional)"),
      "c@contoso.example",
    );
    await user.click(screen.getByRole("button", { name: "Create draft run" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/w/ws/runs/r9"),
    );
    const body = sent.find((s) => s.url.endsWith("/runs"))!.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      skillId: "k1",
      input: {
        objective: "Welcome Contoso",
        context: "",
        target: "c@contoso.example",
      },
    });
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      screen
        .getByRole("link", { name: "Welcome Northwind" })
        .getAttribute("href"),
    ).toBe("/w/ws/runs/r1");
  });
});
describe("RunDetail", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    input: { objective: "Welcome Northwind", context: "", target: "" },
    status: "queued",
    current_step: 1,
    output: null,
    citations: null,
    error_code: null,
    engine: null,
    usage_kind: "unknown",
    input_tokens: null,
    output_tokens: null,
    cost_microusd: null,
    ...over,
  });
  const steps = [
    {
      ordinal: 1,
      name: "Resolve sources",
      status: "pending",
      finished_at: null,
    },
    { ordinal: 2, name: "Draft", status: "pending", finished_at: null },
  ];
  const url = base + "/runs/r1";
  it("loads, processes a queued run and shows the refreshed status", async () => {
    let processed = false;
    const { sent } = fakeFetch({
      ["GET " + url]: () => ({
        body: {
          run: run(
            processed
              ? {
                  status: "draft_ready",
                  output: { summary: "s", draft: "d", proposals: [] },
                  citations: [],
                }
              : {},
          ),
          steps,
        },
      }),
      ["POST " + url + "/process"]: () => {
        processed = true;
        return { body: { id: "r1" } };
      },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect(screen.getByRole("status").textContent).toBe("Loading run history…");
    await userEvent.click(
      await screen.findByRole("button", { name: "Process draft" }),
    );
    expect(
      (await screen.findByText("Run status: draft_ready")).getAttribute("role"),
    ).toBe("status");
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({});
    expect(
      screen.getByRole("heading", { name: "Draft for human review" }),
    ).toBeTruthy();
  });
  it("a running run exposes a single live status region", async () => {
    fakeFetch({
      ["GET " + url]: { body: { run: run({ status: "running" }), steps } },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect(
      await screen.findByText(/This view checks for completion/),
    ).toBeTruthy();
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toEqual([
      "Run status: running",
    ]);
  });
  it.each([
    ["timeout", /exceeded its deadline/],
    ["missing_sources", /Required knowledge is missing/],
    ["brand_new_code", /Run failed safely\. No action was executed\./],
  ])("failed runs explain %s safely", async (code, text) => {
    fakeFetch({
      ["GET " + url]: {
        body: { run: run({ status: "failed", error_code: code }), steps },
      },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
  });
  it("reports usage truthfully: unknown stays unknown, local runs cost $0", async () => {
    fakeFetch({
      ["GET " + url]: {
        body: {
          run: run({
            status: "failed",
            error_code: "invalid_usage",
            engine: "paid",
          }),
          steps,
        },
      },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect(await screen.findByText("Unknown / Unknown")).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    cleanup();
    fakeFetch({
      ["GET " + url]: {
        body: {
          run: run({
            status: "failed",
            error_code: "timeout",
            engine: "local-excerpts-v1",
            usage_kind: "not_applicable",
            input_tokens: 0,
            output_tokens: 0,
            cost_microusd: "0",
          }),
          steps,
        },
      },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect(
      await screen.findByText("Local drafting; no model tokens"),
    ).toBeTruthy();
    expect(screen.getByText("$0.000000")).toBeTruthy();
  });
  it("blocked proposals show the target and hand off to an approval request", async () => {
    const output = {
      summary: "Local draft",
      draft: "Hello Northwind",
      proposals: [
        {
          kind: "send_message",
          target: "c@n.example",
          payload: "Hello Northwind",
          reason: "Request approval to review the exact action.",
        },
      ],
    };
    const { sent } = fakeFetch({
      ["GET " + url]: {
        body: {
          run: run({ status: "draft_ready", output, citations: [] }),
          steps,
        },
      },
      ["POST " + base + "/approvals"]: { body: { id: "a1" } },
    });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect(
      await screen.findByText("Proposed target: c@n.example"),
    ).toBeTruthy();
    expect(
      screen.getByText("Approval required. Execution disabled."),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Request approval" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/w/ws/approvals/a1"),
    );
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({
      runId: "r1",
      proposalIndex: 0,
    });
  });
  it("unavailable runs show an alert instead of stale content", async () => {
    fakeFetch({ ["GET " + url]: { status: 404, body: {} } });
    render(<RunDetail workspaceId="ws" runId="r1" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Run unavailable",
    );
  });
});
