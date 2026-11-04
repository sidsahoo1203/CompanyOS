import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { signUp } from "./sign-up";
const origin = "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3100");
test("knowledge: real uploads, citations, isolation, failure states, mobile and accessibility", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180000);
  const password = "Local-Knowledge-Test!" + randomUUID();
  const email = "knowledge-" + randomUUID() + "@e2e.example";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUp(
    page.request,
    { name: "Knowledge Owner", email, password },
    { Origin: origin },
  );
  const created = await page.request.post("/api/workspaces", {
    headers: { Origin: origin },
    data: {
      name: "Knowledge Studio",
      industry: "Digital agency",
      timezone: "UTC",
      language: "en",
      retentionDays: 90,
    },
  });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).id;
  const api = "/api/workspaces/" + id;
  const library = "/w/" + id + "/knowledge";
  await page.goto(library);
  await expect(page.getByText(/No knowledge sources yet/)).toBeVisible();
  await page.getByLabel("Source title").fill("Agency handbook");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Fictional local reference documents.");
  await page
    .getByLabel("Tags, separated by commas")
    .fill("onboarding, operations");
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Source saved.");
  const source = (await (await page.request.get(api + "/knowledge")).json())
    .sources[0].id;
  const text =
    "Client onboarding process begins with a kickoff meeting. The account manager records the project brief.";
  await page.getByLabel("Document file").setInputFiles({
    name: "onboarding.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Document ready for search.",
    { timeout: 30000 },
  );
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  const doc = (await (await page.request.get(api + "/knowledge")).json())
    .documents[0].id;
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByLabel("Keywords", { exact: true })
    .fill("client onboarding process");
  await page.getByRole("button", { name: "Search sources" }).click();
  await expect(page.locator("blockquote")).toHaveText(text);
  await page.screenshot({
    path: "docs/screenshots/knowledge-library.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await page
    .getByLabel("Your question")
    .fill("What is the client onboarding process?");
  await page.getByRole("button", { name: "Find an answer" }).click();
  await expect(
    page.getByRole("heading", { name: "From your sources" }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toHaveText(text);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const cite = page.getByRole("link", {
    name: /Agency handbook · onboarding.txt/,
  });
  await expect(cite).toHaveAttribute(
    "href",
    "/w/" + id + "/knowledge/documents/" + doc + "#chunk-1",
  );
  await cite.click();
  await expect(page.locator("#chunk-1")).toContainText(text);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await page.getByLabel("Your question").fill("Unknown payroll regulation");
  await page.getByRole("button", { name: "Find an answer" }).click();
  await expect(
    page.getByRole("heading", { name: "Not enough knowledge" }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toHaveCount(0);
  await page.goto(library);
  await page
    .getByRole("button", {
      name: /Agency handbook Active|Agency handbook workspace/,
    })
    .click();
  await page.getByLabel("Document file").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-corrupt"),
  });
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unable to read",
    {
      timeout: 30000,
    },
  );
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Process / retry" }),
  ).toBeVisible();
  const upload = api + "/knowledge/" + source + "/documents";
  const rawHeaders = {
    Origin: origin,
    "Content-Type": "application/octet-stream",
    "x-file-name": "bad.exe",
  };
  expect(
    (
      await page.request.post(upload, {
        headers: rawHeaders,
        data: Buffer.from("MZ executable"),
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await page.request.post(upload, {
        headers: { ...rawHeaders, "x-file-name": "..%2Fbad.txt" },
        data: Buffer.from("safe"),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post(upload, {
        headers: { ...rawHeaders, Origin: "https://attacker.example" },
        data: Buffer.from("safe"),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(api + "/assistant", {
        headers: { Origin: origin },
        data: { question: "client", workspaceId: randomUUID() },
      })
    ).status(),
  ).toBe(400);
  const outsider = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  await signUp(outsider, {
    name: "Other workspace owner",
    email: "outside-" + randomUUID() + "@e2e.example",
    password,
  });
  expect((await outsider.get(api + "/documents/" + doc)).status()).toBe(404);
  expect(
    (
      await outsider.post(api + "/assistant", {
        data: { question: "client onboarding" },
      })
    ).status(),
  ).toBe(404);
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const memberEmail = "reader-" + randomUUID() + "@e2e.example";
  await signUp(member, {
    name: "Knowledge Reader",
    email: memberEmail,
    password,
  });
  const invite = await page.request.post(api + "/invitations", {
    headers: { Origin: origin },
    data: { email: memberEmail, role: "member" },
  });
  expect(invite.ok()).toBe(true);
  const invitation = await invite.json();
  const token = invitation.token ?? invitation.url?.split("#")[1];
  expect(
    (await member.post("/api/invitations/accept", { data: { token } })).ok(),
  ).toBe(true);
  expect(
    (
      await member.post(upload, {
        headers: { ...rawHeaders, "x-file-name": "member.txt" },
        data: Buffer.from("safe"),
      })
    ).status(),
  ).toBe(403);
  expect((await member.get(api + "/documents/" + doc)).status()).toBe(200);
  await page.getByLabel("Who can access this source?").selectOption("admins");
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Source saved.");
  expect((await member.get(api + "/documents/" + doc)).status()).toBe(404);
  expect(
    (
      await (
        await member.post(api + "/assistant", {
          data: { question: "client onboarding" },
        })
      ).json()
    ).status,
  ).toBe("insufficient_knowledge");
  await page
    .getByLabel("Archive source (exclude from search and answers)")
    .check();
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Source saved.");
  expect(
    (
      await (
        await page.request.post(api + "/knowledge/search", {
          headers: { Origin: origin },
          data: { question: "client onboarding" },
        })
      ).json()
    ).citations,
  ).toEqual([]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/knowledge-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
  await outsider.dispose();
  await member.dispose();
});
