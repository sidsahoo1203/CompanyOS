import { deflateSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
export function docx(
  text = "Client onboarding starts with a kickoff meeting.",
  extra: Record<string, Uint8Array> = {},
) {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
        text +
        "</w:t></w:r></w:p></w:body></w:document>",
    ),
    ...extra,
  });
}
export function pdf(text = "Client onboarding starts with a kickoff meeting.") {
  const stream =
    "BT /F1 12 Tf 50 700 Td (" + text.replace(/[()\\]/g, " ") + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let output = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += index + 1 + " 0 obj\n" + object + "\nendobj\n";
  }
  const start = Buffer.byteLength(output);
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1))
    output += String(offset).padStart(10, "0") + " 00000 n \n";
  output +=
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF";
  return Buffer.from(output);
}
// One-page PDF whose content stream is FlateDecode-compressed: `inflated`
// bytes of spaces after a short text operator, so it decompresses to far more
// than its file size.
export function flatePdf(inflated: number) {
  const stream = deflateSync(
    Buffer.concat([
      Buffer.from("BT /F1 12 Tf 50 700 Td (Expanded) Tj ET "),
      Buffer.alloc(inflated, 0x20),
    ]),
  );
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  const offsets: number[] = [];
  const size = () => parts.reduce((sum, part) => sum + part.length, 0);
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    Buffer.concat([
      Buffer.from(
        "<< /Length " + stream.length + " /Filter /FlateDecode >>\nstream\n",
      ),
      stream,
      Buffer.from("\nendstream"),
    ]),
  ];
  for (const [index, object] of objects.entries()) {
    offsets.push(size());
    parts.push(Buffer.from(index + 1 + " 0 obj\n"), Buffer.from(object));
    parts.push(Buffer.from("\nendobj\n"));
  }
  const start = size();
  let tail = "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets)
    tail += String(offset).padStart(10, "0") + " 00000 n \n";
  tail += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF";
  parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}
