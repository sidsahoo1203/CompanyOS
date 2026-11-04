import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { authPool, tenantPool } from "@/lib/db";
import { createWorkspace } from "@/lib/workspaces";
import {
  saveSource,
  uploadDocument,
  processDocument,
  retrieve,
} from "@/lib/knowledge";
import { publicError } from "@/lib/errors";
const owner = "ml-" + randomUUID();
const sourceInput = {
  title: "बहुभाषी संदर्भ",
  description: "Multilingual reference",
  tags: ["हिंदी"],
  scope: "workspace" as const,
  archived: false,
};
let ws: string;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/companyos_test")
    throw new Error("Local isolated test DB required.");
  await authPool().query(
    'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',
    [owner, "बहुभाषी Owner", owner + "@multilingual.example"],
  );
  ws = await createWorkspace(owner, {
    name: "बहुभाषी Agency",
    industry: "Digital agency",
    timezone: "Asia/Kolkata",
    language: "en",
    retentionDays: 90,
  });
  const source = await saveSource(owner, ws, null, sourceInput);
  const doc = await uploadDocument(
    owner,
    ws,
    source,
    "शुल्क-विवरण.txt",
    "",
    Buffer.from(
      "परियोजना शुल्क ₹50,000 है। भुगतान 30 दिनों में करना होगा।\nகட்டணம் விவரம் இங்கே உள்ளது.",
    ),
  );
  expect((await processDocument(owner, ws, doc)).status).toBe("ready");
});
afterAll(async () => {
  await authPool().end();
  await tenantPool().end();
});
it.each(["शुल्क", "भुगतान", "परियोजना शुल्क", "கட்டணம்"])(
  "finds Indic-script passages for %s",
  async (question) => {
    const [citation] = await retrieve(owner, ws, question);
    expect(citation?.filename).toBe("शुल्क-विवरण.txt");
    expect(citation.quote).toContain("₹50,000");
  },
);
it("still abstains when an Indic word is absent", async () => {
  expect(await retrieve(owner, ws, "अनुबंध")).toEqual([]);
});
it("a NUL character reaching PostgreSQL maps to a 400, not a server error", async () => {
  const failure = await saveSource(owner, ws, null, {
    ...sourceInput,
    title: "Bad" + String.fromCharCode(0) + "title",
  }).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: expect.any(String) });
  expect(publicError(failure).status).toBe(400);
});
