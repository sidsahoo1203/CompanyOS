import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
const MAX_TEXT = 200000;
function fault(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function text(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fault("invalid_format");
  }
}
export async function parseDocument(bytes, extension) {
  const segments = [];
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Provide pdf.js's worker code in-process. Otherwise it imports
    // "./pdf.worker.mjs" at runtime, which does not exist once bundled, and
    // every valid PDF fails in production builds.
    globalThis.pdfjsWorker ??=
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
      useWasm: false,
    });
    let pdf;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 100) fault("page_limit");
      if ((await pdf.getJSActions()) || (await pdf.getAttachments()))
        fault("active_content");
      let length = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const value = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("");
        length += value.length;
        if (length > MAX_TEXT) fault("text_limit");
        segments.push({ location: "Page " + i, text: value });
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
  } else if (extension === "docx") {
    let total = 0;
    let count = 0;
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        count++;
        total += entry.originalSize;
        if (
          count > 500 ||
          total > 20 * 1024 * 1024 ||
          entry.originalSize > 10 * 1024 * 1024 ||
          entry.name.includes("..") ||
          entry.name.startsWith("/") ||
          entry.name.includes("\\")
        )
          fault("archive_limit");
        if (/vbaProject|embeddings\/|activeX\//i.test(entry.name))
          fault("active_content");
        return ["word/document.xml", "[Content_Types].xml"].includes(
          entry.name,
        );
      },
    });
    if (!entries["word/document.xml"] || !entries["[Content_Types].xml"])
      fault("invalid_format");
    const xml = text(entries["word/document.xml"]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fault("active_content");
    if (XMLValidator.validate(xml) !== true) fault("invalid_format");
    const parsed = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: true,
      processEntities: true,
      parseTagValue: false,
    }).parse(xml);
    let output = "";
    function walk(nodes) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes)
        for (const [key, value] of Object.entries(node)) {
          if (key === "w:t")
            for (const item of value) output += String(item["#text"] ?? "");
          else if (key === "w:tab") output += "\t";
          else if (key === "w:br") output += "\n";
          else {
            walk(value);
            if (key === "w:p") output += "\n";
          }
          if (output.length > MAX_TEXT) fault("text_limit");
        }
    }
    walk(parsed);
    segments.push({ location: "Document text", text: output });
  } else {
    const value = text(bytes);
    if (value.length > MAX_TEXT) fault("text_limit");
    segments.push({
      location: extension === "csv" ? "CSV text" : "Document text",
      text: value,
    });
  }
  const chunks = [];
  for (const segment of segments) {
    const value = segment.text
      .replace(/\r\n?/g, "\n")
      .replaceAll("\u0000", "")
      .trim();
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 1800, value.length);
      if (end < value.length) {
        const split = value.lastIndexOf("\n", end);
        if (split > start + 500) end = split;
      }
      const content = value.slice(start, end).trim();
      if (content)
        chunks.push({
          content,
          location:
            segment.location + " · characters " + (start + 1) + "–" + end,
        });
      start = end;
    }
  }
  if (!chunks.length) fault("no_text");
  if (chunks.length > 500) fault("text_limit");
  return chunks;
}
if (parentPort) {
  try {
    parentPort.postMessage({
      chunks: await parseDocument(
        new Uint8Array(workerData.bytes),
        workerData.extension,
      ),
    });
  } catch (error) {
    const allowed = [
      "active_content",
      "page_limit",
      "text_limit",
      "archive_limit",
      "no_text",
    ];
    parentPort.postMessage({
      error: allowed.includes(error.code) ? error.code : "invalid_format",
    });
  }
}
