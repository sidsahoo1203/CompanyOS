import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { signUp } from "./sign-up";
import { pdf, docx } from "../fixtures/documents";
const origin = "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3100");
test("production build: real PDF and DOCX processing, and member removal", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180000);
  const headers = { Origin: origin };
  const password = "Local-Operations-Test!" + randomUUID();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signUp(
    page.request,
    {
      name: "Operations Owner",
      email: "ops-" + randomUUID() + "@e2e.example",
      password,
    },
    headers,
  );
  const id = (
    await (
      await page.request.post("/api/workspaces", {
        headers,
        data: {
          name: "Operations Studio",
          industry: "Digital agency",
          timezone: "UTC",
          language: "en",
          retentionDays: 90,
        },
      })
    ).json()
  ).id;
  const api = "/api/workspaces/" + id;
  const source = (
    await (
      await page.request.post(api + "/knowledge", {
        headers,
        data: {
          title: "Kickoff guides",
          description: "",
          tags: [],
          scope: "workspace",
          archived: false,
        },
      })
    ).json()
  ).id;

  // The parser runs from the bundled worker in the production build.
  for (const [filename, bytes] of [
    ["kickoff.pdf", pdf("Kickoff meetings confirm the signed brief.")],
    ["kickoff.docx", docx("Kickoff meetings confirm the signed brief.")],
  ] as const) {
    const uploaded = await page.request.post(
      api + "/knowledge/" + source + "/documents",
      {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "x-file-name": filename,
        },
        data: Buffer.from(bytes),
      },
    );
    expect(uploaded.ok()).toBe(true);
    const processed = await page.request.post(
      api + "/documents/" + (await uploaded.json()).id + "/process",
      { headers, data: {} },
    );
    expect(await processed.json()).toMatchObject({
      status: "ready",
      message: null,
    });
  }
  const search = await (
    await page.request.post(api + "/knowledge/search", {
      headers,
      data: { question: "kickoff signed brief" },
    })
  ).json();
  expect(
    search.citations.map((item: { filename: string }) => item.filename).sort(),
  ).toEqual(["kickoff.docx", "kickoff.pdf"]);

  // Offboarding: the owner removes a member, whose access ends immediately.
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: headers,
  });
  const memberEmail = "leaver-" + randomUUID() + "@e2e.example";
  await signUp(member, {
    name: "Departing Member",
    email: memberEmail,
    password,
  });
  const invitation = await (
    await page.request.post(api + "/invitations", {
      headers,
      data: { email: memberEmail, role: "member" },
    })
  ).json();
  expect(
    (
      await member.post("/api/invitations/accept", {
        data: { token: invitation.token },
      })
    ).ok(),
  ).toBe(true);
  expect((await member.get(api)).status()).toBe(200);
  await page.goto("/w/" + id + "/members");
  await expect(page.getByText(memberEmail)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Leave workspace" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove Departing Member", exact: true })
    .click();
  await expect(
    page.getByText("loses access on their next request", { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", {
      name: "Confirm: Remove Departing Member",
      exact: true,
    })
    .click();
  await expect(page.getByText(memberEmail)).toHaveCount(0);
  expect((await member.get(api)).status()).toBe(404);
  expect((await member.get(api + "/knowledge")).status()).toBe(404);
  expect(
    (
      await member.delete(api + "/members", {
        data: { userId: "anyone" },
      })
    ).status(),
  ).toBe(404);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(pageErrors).toEqual([]);
  await member.dispose();
});
