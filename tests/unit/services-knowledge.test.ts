import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, role, pgError, type Handler } from "./support/fake-db";
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({
  asActor: vi.fn(async (_u: string, _w: string, op: (db: unknown) => unknown) =>
    op(state.client),
  ),
}));
const processing = vi.hoisted(() => ({ processBytes: vi.fn() }));
vi.mock("@/lib/document-processing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/document-processing")>()),
  processBytes: processing.processBytes,
}));
import {
  listKnowledge,
  saveSource,
  uploadDocument,
  processDocument,
  getDocument,
  retrieve,
  answerQuestion,
} from "@/lib/knowledge";
const ws = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const doc = "33333333-3333-4333-8333-333333333333";
const sourceInput = {
  title: "Handbook",
  description: "",
  tags: [],
  scope: "workspace" as const,
  archived: false,
};
const passage = {
  document_id: doc,
  source_id: source,
  title: "Handbook",
  filename: "a.txt",
  version: 2,
  ordinal: 3,
  location: "Document text · characters 1–20",
  content: "Kickoff starts with a brief.",
};
function script(handlers: Handler[]) {
  const fake = fakeClient(handlers);
  state.client = fake.client;
  return fake;
}
const index = (calls: { sql: string }[], text: string) =>
  calls.findIndex((c) => c.sql.includes(text));
beforeEach(() => processing.processBytes.mockReset());
describe("sources", () => {
  it("lists sources and documents for any member, without payload bytes", async () => {
    const { calls } = script([
      role("member"),
      [
        "FROM app.knowledge_source WHERE workspace_id=$1 ORDER BY",
        [{ id: source }],
      ],
      ["FROM app.document WHERE workspace_id=$1 ORDER BY", [{ id: doc }]],
    ]);
    expect(await listKnowledge("u1", ws)).toEqual({
      sources: [{ id: source }],
      documents: [{ id: doc }],
    });
    const documentSql = calls.find((c) => c.sql.includes("FROM app.document"))!;
    expect(documentSql.sql).not.toMatch(/payload|\*/);
  });
  it("validates source input before touching the database", async () => {
    const { calls } = script([]);
    expect(() =>
      saveSource("u1", ws, null, {
        ...sourceInput,
        scope: "everyone" as never,
      }),
    ).toThrow();
    expect(() =>
      saveSource("u1", ws, null, { ...sourceInput, owner: "x" } as never),
    ).toThrow();
    expect(calls).toEqual([]);
  });
  it("members cannot save sources; admins can", async () => {
    script([role("member")]);
    await expect(saveSource("u1", ws, null, sourceInput)).rejects.toMatchObject(
      { status: 403 },
    );
    const { calls } = script([
      role("admin"),
      ["app.save_source", [{ id: source }]],
    ]);
    expect(await saveSource("u1", ws, source, sourceInput)).toBe(source);
    expect(calls.at(-1)?.params).toEqual([
      ws,
      source,
      "Handbook",
      "",
      [],
      "workspace",
      false,
    ]);
  });
});
describe("uploads", () => {
  const bytes = Buffer.from("Kickoff notes");
  it("authorizes, validates, rate-limits, then stores with a SHA-256 of the bytes", async () => {
    const { calls } = script([
      role("admin"),
      ["app.require_source_admin", []],
      ["app.knowledge_limit", []],
      ["app.store_document", [{ id: doc }]],
    ]);
    expect(
      await uploadDocument("u1", ws, source, "notes.md", "text/plain", bytes),
    ).toBe(doc);
    expect(index(calls, "require_source_admin")).toBeLessThan(
      index(calls, "knowledge_limit"),
    );
    const stored = calls.find((c) => c.sql.includes("store_document"))!;
    expect(stored.params[2]).toBe("notes.md");
    // The media type is normalized from the extension, not trusted from the client.
    expect(stored.params[3]).toBe("text/markdown");
    expect(stored.params[5]).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(
      calls.find((c) => c.sql.includes("knowledge_limit"))?.params,
    ).toEqual([ws]);
  });
  it("rejects unsafe files before anything is stored", async () => {
    const { calls } = script([role("admin"), ["app.require_source_admin", []]]);
    await expect(
      uploadDocument("u1", ws, source, "../evil.txt", "", bytes),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      uploadDocument("u1", ws, source, "run.exe", "", bytes),
    ).rejects.toMatchObject({ status: 415 });
    expect(index(calls, "store_document")).toBe(-1);
  });
  it("members are refused before validation or storage", async () => {
    const { calls } = script([role("member")]);
    await expect(
      uploadDocument("u1", ws, source, "a.txt", "", bytes),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(1);
  });
});
describe("processing", () => {
  it("passes the claimed bytes to the parser and finishes with the lease token", async () => {
    processing.processBytes.mockResolvedValue({
      status: "ready",
      error: null,
      scanner: "Basic local checks; antivirus not configured",
      chunks: [{ location: "Document text", content: "Hello" }],
    });
    const payload = Buffer.from("Hello");
    const { calls } = script([
      role("admin"),
      [
        "app.claim_document",
        [{ token: "lease-1", payload, filename: "Notes.TXT" }],
      ],
      ["app.finish_document", []],
    ]);
    expect(await processDocument("u1", ws, doc)).toEqual({
      status: "ready",
      message: null,
    });
    expect(processing.processBytes).toHaveBeenCalledWith(
      payload,
      "txt",
      undefined,
    );
    const finished = calls.find((c) => c.sql.includes("finish_document"))!;
    expect(finished.params.slice(0, 6)).toEqual([
      ws,
      doc,
      "lease-1",
      "ready",
      null,
      "Basic local checks; antivirus not configured",
    ]);
    expect(JSON.parse(finished.params[6] as string)).toEqual([
      { location: "Document text", content: "Hello" },
    ]);
  });
  it("returns the safe user message for failed or quarantined files", async () => {
    processing.processBytes.mockResolvedValue({
      status: "quarantined",
      error: "prompt_injection",
      scanner: "x",
      chunks: [],
    });
    script([
      role("admin"),
      [
        "app.claim_document",
        [{ token: "t", payload: Buffer.from("x"), filename: "a.txt" }],
      ],
      ["app.finish_document", []],
    ]);
    expect(await processDocument("u1", ws, doc)).toEqual({
      status: "quarantined",
      message:
        "Quarantined: possible instructions targeting the assistant were detected.",
    });
  });
  it("a refused claim never runs the parser", async () => {
    script([role("admin"), ["app.claim_document", pgError("55000")]]);
    await expect(processDocument("u1", ws, doc)).rejects.toMatchObject({
      code: "55000",
    });
    expect(processing.processBytes).not.toHaveBeenCalled();
  });
});
describe("reading and retrieval", () => {
  it("getDocument is 404 when hidden and records an access event when shown", async () => {
    script([
      role("member"),
      ["FROM app.document WHERE workspace_id=$1 AND id=$2", []],
    ]);
    await expect(getDocument("u1", ws, doc)).rejects.toMatchObject({
      status: 404,
    });
    const { calls } = script([
      role("member"),
      [
        "FROM app.document WHERE workspace_id=$1 AND id=$2",
        [{ id: doc, source_id: source }],
      ],
      [
        "FROM app.knowledge_source WHERE workspace_id=$1 AND id=$2",
        [{ id: source }],
      ],
      ["FROM app.document_chunk WHERE", [{ ordinal: 1 }]],
      ["app.knowledge_event", []],
    ]);
    expect((await getDocument("u1", ws, doc)).chunks).toEqual([{ ordinal: 1 }]);
    expect(calls.at(-1)?.params).toEqual([ws, doc]);
  });
  it("rate-limits every search, even stop-word-only questions that return nothing", async () => {
    const { calls } = script([role("member"), ["app.knowledge_limit", []]]);
    expect(await retrieve("u1", ws, "what is the")).toEqual([]);
    expect(calls.map((c) => c.sql).join()).not.toContain("search_vector");
    expect(calls.at(-1)?.params).toEqual([ws, "search"]);
  });
  it("maps rows to citations with document/version/passage links", async () => {
    const { calls } = script([
      role("member"),
      ["app.knowledge_limit", []],
      ["search_vector @@", [passage]],
    ]);
    const [citation] = await retrieve("u1", ws, "How does kickoff start?");
    expect(citation).toEqual({
      documentId: doc,
      sourceId: source,
      title: "Handbook",
      filename: "a.txt",
      version: 2,
      chunk: 3,
      location: passage.location,
      quote: passage.content,
      href: "/w/" + ws + "/knowledge/documents/" + doc + "#chunk-3",
    });
    expect(calls.at(-1)?.params).toEqual([ws, "kickoff start"]);
  });
  it("answers in explicit source-excerpt mode and abstains without matches", async () => {
    script([
      role("member"),
      ["app.knowledge_limit", []],
      ["search_vector @@", []],
    ]);
    expect(await answerQuestion("u1", ws, "kickoff budget")).toMatchObject({
      mode: "source-excerpts",
      status: "insufficient_knowledge",
      citations: [],
    });
    const { calls } = script([
      role("member"),
      ["app.knowledge_limit", []],
      ["search_vector @@", [passage]],
    ]);
    const found = await answerQuestion("u1", ws, "kickoff");
    expect(found.status).toBe("sources_found");
    expect(found.answer).toContain("may not answer every part");
    expect(
      calls.find((c) => c.sql.includes("knowledge_limit"))?.params,
    ).toEqual([ws, "answer"]);
  });
});
