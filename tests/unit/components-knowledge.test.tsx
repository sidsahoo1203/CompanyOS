// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeFetch } from "./support/fake-fetch";
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
import { KnowledgePanel, CitationList } from "@/components/knowledge-panel";
import { KnowledgeAssistant } from "@/components/knowledge-assistant";
const base = "/api/workspaces/ws";
const source = {
  id: "s1",
  title: "Handbook",
  description: "Shared reference",
  tags: ["ops"],
  scope: "workspace",
  archived: false,
};
const documents = [
  {
    id: "d1",
    source_id: "s1",
    filename: "ready.txt",
    version: 2,
    byte_size: 2048,
    chunk_count: 3,
    status: "ready",
    error_code: null,
  },
  {
    id: "d2",
    source_id: "s1",
    filename: "broken.pdf",
    version: 1,
    byte_size: 10,
    chunk_count: 0,
    status: "failed",
    error_code: "invalid_format",
  },
];
const citation = {
  documentId: "d1",
  sourceId: "s1",
  title: "Handbook",
  filename: "ready.txt",
  version: 2,
  chunk: 1,
  location: "Document text · characters 1–20",
  quote: "Kickoff starts with a brief.",
  href: "/w/ws/knowledge/documents/d1#chunk-1",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// jsdom treats a programmatically set file input as empty for "required"
// validation and blocks the submit; real browsers do not. Submit directly.
// jsdom's FormData also ignores files set that way, so provide the chosen file.
function submitUpload(file: File) {
  const Original = FormData;
  vi.stubGlobal(
    "FormData",
    class extends Original {
      get(name: string) {
        return name === "file" ? file : super.get(name);
      }
    },
  );
  fireEvent.submit(screen.getByLabelText("Document file").closest("form")!);
}
const library = (sources = [source], docs = documents) => ({
  body: { sources, documents: docs },
});
describe("KnowledgePanel", () => {
  it("announces loading, then an empty state tailored to the viewer", async () => {
    fakeFetch({ ["GET " + base + "/knowledge"]: library([], []) });
    render(<KnowledgePanel workspaceId="ws" manage />);
    expect(screen.getByRole("status").textContent).toBe(
      "Loading knowledge sources…",
    );
    expect(
      await screen.findByText(/Create your first source below/),
    ).toBeTruthy();
    cleanup();
    render(<KnowledgePanel workspaceId="ws" manage={false} />);
    expect(
      await screen.findByText(/Ask an administrator to add a source/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Source title")).toBeNull();
    expect(
      screen.getByText("Only owners and admins can manage knowledge."),
    ).toBeTruthy();
  });
  it("shows an alert when the library cannot load", async () => {
    fakeFetch({ ["GET " + base + "/knowledge"]: { status: 503, body: {} } });
    render(<KnowledgePanel workspaceId="ws" manage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Knowledge could not be loaded. Try again.",
    );
  });
  it("creates a source with cleaned tags and reloads the library", async () => {
    const { sent } = fakeFetch({
      ["GET " + base + "/knowledge"]: library([], []),
      ["POST " + base + "/knowledge"]: { body: { id: "s9" } },
    });
    render(<KnowledgePanel workspaceId="ws" manage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Source title"), "Pricing");
    await user.type(
      screen.getByLabelText("Tags, separated by commas"),
      " fees, ,India ",
    );
    await user.selectOptions(
      screen.getByLabelText("Who can access this source?"),
      "admins",
    );
    await user.click(screen.getByRole("button", { name: "Save source" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Source saved.",
    );
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({
      title: "Pricing",
      description: "",
      tags: ["fees", "India"],
      scope: "admins",
      archived: false,
    });
    expect(sent.filter((s) => s.method === "GET")).toHaveLength(2);
  });
  it("lists documents of the selected source with status and retry for unfinished ones", async () => {
    fakeFetch({ ["GET " + base + "/knowledge"]: library() });
    render(<KnowledgePanel workspaceId="ws" manage />);
    const choice = await screen.findByRole("button", { name: /Handbook/ });
    expect(choice.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(choice);
    expect(choice.getAttribute("aria-pressed")).toBe("true");
    const list = screen.getByRole("heading", {
      name: "Documents in Handbook",
    }).parentElement!;
    expect(
      within(list)
        .getByRole("link", { name: "ready.txt" })
        .getAttribute("href"),
    ).toBe("/w/ws/knowledge/documents/d1");
    expect(within(list).getByText("Version 2 · 2 KiB · 3 chunks")).toBeTruthy();
    expect(
      within(list).getAllByRole("button", { name: "Process / retry" }),
    ).toHaveLength(1);
    expect(
      within(list).getByText("Open document for recovery instructions."),
    ).toBeTruthy();
  });
  it("archived sources hide upload and retry controls", async () => {
    fakeFetch({
      ["GET " + base + "/knowledge"]: library([{ ...source, archived: true }]),
    });
    render(<KnowledgePanel workspaceId="ws" manage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Handbook/ }),
    );
    expect(screen.queryByLabelText("Document file")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Process / retry" }),
    ).toBeNull();
  });
  it("refuses files over 5 MiB in the browser without uploading", async () => {
    const { sent } = fakeFetch({ ["GET " + base + "/knowledge"]: library() });
    render(<KnowledgePanel workspaceId="ws" manage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Handbook/ }),
    );
    const big = new File([new Uint8Array(5242881)], "big.pdf", {
      type: "application/pdf",
    });
    await userEvent.upload(screen.getByLabelText("Document file"), big);
    submitUpload(big);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a nonempty file no larger than 5 MiB.",
    );
    expect(sent.some((s) => s.method === "POST")).toBe(false);
  });
  it("uploads raw bytes with an encoded filename, then processes the document", async () => {
    const { sent } = fakeFetch({
      ["GET " + base + "/knowledge"]: library(),
      ["POST " + base + "/knowledge/s1/documents"]: {
        body: { id: "d3", status: "queued" },
      },
      ["POST " + base + "/documents/d3/process"]: {
        body: { status: "ready", message: null },
      },
    });
    render(<KnowledgePanel workspaceId="ws" manage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Handbook/ }),
    );
    const file = new File(["Fees in rupees"], "Fees ₹ 2026.txt", {
      type: "text/plain",
    });
    await userEvent.upload(screen.getByLabelText("Document file"), file);
    submitUpload(file);
    expect((await screen.findByRole("status")).textContent).toBe(
      "Document ready for search.",
    );
    const upload = sent.find((s) => s.url.endsWith("/documents"))!;
    expect(upload.headers.get("content-type")).toBe("application/octet-stream");
    expect(upload.headers.get("x-file-name")).toBe(
      encodeURIComponent("Fees ₹ 2026.txt"),
    );
    expect(upload.headers.get("x-file-type")).toBe("text/plain");
    expect(upload.body).toBe(file);
    expect(sent.find((s) => s.url.endsWith("/process"))?.body).toEqual({});
  });
  it("shows the safe reason when processing quarantines a file", async () => {
    fakeFetch({
      ["GET " + base + "/knowledge"]: library(),
      ["POST " + base + "/documents/d2/process"]: {
        body: {
          status: "quarantined",
          message:
            "Quarantined: active content or embedded files are not accepted.",
        },
      },
    });
    render(<KnowledgePanel workspaceId="ws" manage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Handbook/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Process / retry" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Quarantined",
    );
  });
  it("search shows cited passages, or says nothing matched", async () => {
    const { sent } = fakeFetch({
      ["GET " + base + "/knowledge"]: library(),
      ["POST " + base + "/knowledge/search"]: ({ body }) =>
        JSON.parse(String(body)).question === "kickoff"
          ? { body: { citations: [citation] } }
          : { body: { citations: [] } },
    });
    render(<KnowledgePanel workspaceId="ws" manage={false} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Keywords"), "kickoff");
    await user.click(screen.getByRole("button", { name: "Search sources" }));
    expect(
      await screen.findByText("Kickoff starts with a brief."),
    ).toBeTruthy();
    await user.clear(screen.getByLabelText("Keywords"));
    await user.type(screen.getByLabelText("Keywords"), "budget");
    await user.click(screen.getByRole("button", { name: "Search sources" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "No matching passages in the sources you can access.",
    );
    expect(
      sent.filter((s) => s.url.endsWith("/search")).map((s) => s.body),
    ).toEqual([{ question: "kickoff" }, { question: "budget" }]);
  });
});
describe("CitationList", () => {
  it("renders uploaded text as inert text, never as HTML", () => {
    const { container } = render(
      <CitationList
        citations={[
          {
            ...citation,
            quote: '<img src=x onerror="alert(1)"><script>bad()</script>',
          },
        ]}
      />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByText(/<img src=x onerror/)).toBeTruthy();
    expect(screen.getByRole("link").textContent).toBe(
      "Handbook · ready.txt · v2 · Document text · characters 1–20",
    );
  });
});
describe("KnowledgeAssistant", () => {
  const ask = async (reply: { status?: number; body?: unknown }) => {
    const { sent } = fakeFetch({ ["POST " + base + "/assistant"]: reply });
    render(<KnowledgeAssistant workspaceId="ws" />);
    expect(
      screen.getByText(/Ask a question to see cited excerpts/),
    ).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText("Your question"),
      "What is kickoff?",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Find an answer" }),
    );
    return sent;
  };
  it("labels abstentions clearly", async () => {
    await ask({
      body: {
        status: "insufficient_knowledge",
        answer: "I don’t know based on the sources you can access.",
        citations: [],
      },
    });
    expect(
      await screen.findByRole("heading", { name: "Not enough knowledge" }),
    ).toBeTruthy();
  });
  it("shows cited excerpts for found answers and sends only the question", async () => {
    const sent = await ask({
      body: {
        status: "sources_found",
        answer: "These are matching excerpts.",
        citations: [citation],
      },
    });
    expect(
      await screen.findByRole("heading", { name: "From your sources" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Answer" })).toBeTruthy();
    expect(sent[0].body).toEqual({ question: "What is kickoff?" });
  });
  it("shows errors as alerts", async () => {
    await ask({
      status: 429,
      body: { error: "Knowledge storage or request limit reached." },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "limit reached",
    );
    await waitFor(() =>
      expect(
        screen.queryByText(/Ask a question to see cited excerpts/),
      ).toBeNull(),
    );
  });
});
