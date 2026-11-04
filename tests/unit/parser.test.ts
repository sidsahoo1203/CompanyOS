import { describe, expect, it, vi, afterEach } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseDocument } from "../../scripts/parse-document.mjs";
import { basicScanner, processBytes } from "@/lib/document-processing";
import { docx } from "../fixtures/documents";
type Chunk = { content: string; location: string };
const parse = (bytes: Uint8Array, extension: string): Promise<Chunk[]> =>
  parseDocument(bytes, extension);
const text = (value: string) => Buffer.from(value, "utf8");
const failure = (bytes: Uint8Array, extension: string) =>
  parse(bytes, extension).then(
    () => "parsed",
    (error: { code?: string }) => error.code,
  );
// Minimal valid PDF with one text object per page and optional catalog extras.
function pdfPages(pages: string[], catalogExtra = "") {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R " + catalogExtra + " >>";
  objects[2] =
    "<< /Type /Pages /Kids [" +
    pageIds.map((id) => id + " 0 R").join(" ") +
    "] /Count " +
    pages.length +
    " >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((content, index) => {
    const stream = "BT /F1 12 Tf 50 700 Td (" + content + ") Tj ET";
    objects[pageIds[index]] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents " +
      (pageIds[index] + 1) +
      " 0 R >>";
    objects[pageIds[index] + 1] =
      "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream";
  });
  let output = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(output);
    output += id + " 0 obj\n" + objects[id] + "\nendobj\n";
  }
  const start = Buffer.byteLength(output);
  output += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id++)
    output += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  output +=
    "trailer\n<< /Size " +
    objects.length +
    " /Root 1 0 R >>\nstartxref\n" +
    start +
    "\n%%EOF";
  return Buffer.from(output);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("text chunking", () => {
  it("splits long text into 1,800-character chunks with exact 1-based ranges", async () => {
    const chunks = await parse(text("a".repeat(4000)), "txt");
    expect(chunks.map((c) => c.location)).toEqual([
      "Document text · characters 1–1800",
      "Document text · characters 1801–3600",
      "Document text · characters 3601–4000",
    ]);
    expect(chunks.map((c) => c.content.length)).toEqual([1800, 1800, 400]);
  });
  it("prefers a line break inside the window when it is past 500 characters", async () => {
    const chunks = await parse(
      text("a".repeat(1000) + "\n" + "b".repeat(1500)),
      "md",
    );
    expect(chunks[0].content).toBe("a".repeat(1000));
    expect(chunks[1].content).toBe("b".repeat(1500));
  });
  it("ignores early line breaks that would create tiny chunks", async () => {
    const chunks = await parse(
      text("a".repeat(100) + "\n" + "b".repeat(2000)),
      "txt",
    );
    expect(chunks[0].content.length).toBe(1800);
  });
  it("normalizes CRLF, strips NUL bytes and trims", async () => {
    const [chunk] = await parse(text("  one\r\ntwo\rthree\u0000  "), "txt");
    expect(chunk.content).toBe("one\ntwo\nthree");
  });
  it("labels CSV separately and keeps Unicode intact", async () => {
    const csv = "name,fee\nRiya,₹500 नमस्ते";
    const [chunk] = await parse(text(csv), "csv");
    // Ranges are UTF-16 offsets, matching JavaScript string positions.
    expect(chunk.location).toBe("CSV text · characters 1–" + csv.length);
    expect(chunk.content).toContain("₹500 नमस्ते");
  });
  it("whitespace-only, invalid UTF-8 and over-long text fail with stable codes", async () => {
    expect(await failure(text("   \n\t "), "txt")).toBe("no_text");
    expect(await failure(Buffer.from([0xc3, 0x28]), "txt")).toBe(
      "invalid_format",
    );
    expect(await failure(text("x".repeat(200001)), "txt")).toBe("text_limit");
    expect((await parse(text("x".repeat(200000)), "txt")).length).toBe(112);
  });
});
describe("DOCX extraction", () => {
  const document = (body: string, extra: Record<string, Uint8Array> = {}) =>
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="w"><w:body>' + body + "</w:body></w:document>",
      ),
      ...extra,
    });
  it("renders paragraphs, tabs and line breaks", async () => {
    const [chunk] = await parse(
      document(
        "<w:p><w:r><w:t>Scope</w:t><w:tab/><w:t>Fixed</w:t></w:r></w:p>" +
          "<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>",
      ),
      "docx",
    );
    expect(chunk.content).toBe("Scope\tFixed\nLine one\nLine two");
    expect(chunk.location).toMatch(/^Document text · characters/);
  });
  it.each([
    [
      "embedded objects",
      { "word/embeddings/oleObject1.bin": strToU8("x") },
      "active_content",
    ],
    [
      "ActiveX controls",
      { "word/activeX/activeX1.xml": strToU8("x") },
      "active_content",
    ],
    ["macros", { "word/vbaProject.bin": strToU8("x") }, "active_content"],
    ["path traversal", { "../evil.xml": strToU8("x") }, "archive_limit"],
    ["absolute paths", { "/etc/passwd": strToU8("x") }, "archive_limit"],
    ["backslash paths", { "word\\evil.xml": strToU8("x") }, "archive_limit"],
  ])("rejects archives with %s", async (_, extra, code) => {
    expect(await failure(document("<w:p/>", extra), "docx")).toBe(code);
  });
  it("rejects archives with more than 500 entries", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 500; i++)
      entries["word/media/" + i + ".txt"] = strToU8("x");
    expect(await failure(document("<w:p/>", entries), "docx")).toBe(
      "archive_limit",
    );
  });
  it("rejects DOCTYPE/entity declarations, invalid XML and missing parts", async () => {
    expect(
      await failure(
        zipSync({
          "[Content_Types].xml": strToU8("<Types/>"),
          "word/document.xml": strToU8(
            '<!DOCTYPE x [<!ENTITY a "b">]><w:document/>',
          ),
        }),
        "docx",
      ),
    ).toBe("active_content");
    expect(
      await failure(
        zipSync({
          "[Content_Types].xml": strToU8("<Types/>"),
          "word/document.xml": strToU8("<w:document><unclosed></w:document>"),
        }),
        "docx",
      ),
    ).toBe("invalid_format");
    expect(
      await failure(
        zipSync({ "word/document.xml": strToU8("<w:document/>") }),
        "docx",
      ),
    ).toBe("invalid_format");
    expect(await failure(docx(""), "docx")).toBe("no_text");
  });
});
describe("PDF extraction", () => {
  it("keeps page numbers in each chunk's location", async () => {
    const chunks = await parse(
      pdfPages(["First page text", "Second page text"]),
      "pdf",
    );
    expect(chunks.map((c) => [c.location.split(" · ")[0], c.content])).toEqual([
      ["Page 1", "First page text"],
      ["Page 2", "Second page text"],
    ]);
  });
  it("refuses more than 100 pages", async () => {
    expect(await failure(pdfPages(Array(101).fill("x")), "pdf")).toBe(
      "page_limit",
    );
    expect((await parse(pdfPages(Array(100).fill("x")), "pdf")).length).toBe(
      100,
    );
  });
  it("quarantines PDFs with document JavaScript", async () => {
    const bytes = pdfPages(
      ["Hello"],
      "/OpenAction << /S /JavaScript /JS (app.alert(1)) >>",
    );
    expect(await failure(bytes, "pdf")).toBe("active_content");
  });
  it("text-free PDFs report that OCR is needed", async () => {
    expect(await failure(pdfPages([""]), "pdf")).toBe("no_text");
  });
});
describe("upload safety scanner", () => {
  it.each([
    [
      "EICAR test signature",
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    ],
    ["PDF JavaScript", "%PDF-1.7 /JavaScript"],
    ["PDF JS action", "%PDF-1.7 << /JS (x) >>"],
    ["launch action", "%PDF-1.7 /Launch"],
    ["embedded file", "%PDF-1.7 /EmbeddedFile"],
  ])("blocks %s", async (_, content) => {
    expect((await basicScanner(text(content))).outcome).toBe("block");
  });
  it("allows ordinary text and says it is not antivirus", async () => {
    expect(await basicScanner(text("JSON and JavaScript tutorials"))).toEqual({
      outcome: "allow",
      label: "Basic local checks; antivirus not configured",
    });
  });
  it("a scanner that never answers fails the document after 5 seconds", async () => {
    vi.useFakeTimers();
    const pending = processBytes(
      text("hello"),
      "txt",
      () => new Promise(() => {}),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      status: "failed",
      error: "scan_failed",
      chunks: [],
    });
  });
  it("a configured scanner satisfies required-antivirus mode", async () => {
    vi.stubEnv("UPLOAD_REQUIRE_ANTIVIRUS", "true");
    const result = await processBytes(
      text("Kickoff notes"),
      "txt",
      async () => ({
        outcome: "allow",
        label: "Test scanner",
      }),
    );
    expect(result).toMatchObject({ status: "ready", scanner: "Test scanner" });
  });
  it("parser-detected active content is quarantined, not just failed", async () => {
    const result = await processBytes(
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "word/document.xml": strToU8("<w:document/>"),
        "word/vbaProject.bin": strToU8("x"),
      }),
      "docx",
    );
    expect(result).toMatchObject({
      status: "quarantined",
      error: "active_content",
    });
  });
});
