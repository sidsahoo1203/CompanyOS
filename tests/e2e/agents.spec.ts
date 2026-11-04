import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { signUp } from "./sign-up";
const origin = "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3100");
test.use({ actionTimeout: 15000 });
test("procedures and agents: publish, pin, draft, inspect policy, source failures and permissions", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180000);
  const headers = { Origin: origin };
  const password = "Local-Agent-Test!" + randomUUID();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signUp(
    page.request,
    {
      name: "Procedure Owner",
      email: "sop-" + randomUUID() + "@e2e.example",
      password,
    },
    headers,
  );
  const workspace = await page.request.post("/api/workspaces", {
    headers,
    data: {
      name: "Procedure Studio",
      industry: "Digital agency",
      timezone: "UTC",
      language: "en",
      retentionDays: 90,
    },
  });
  const id = (await workspace.json()).id;
  const api = "/api/workspaces/" + id;
  const route = "/w/" + id + "/procedures";
  const sourceInput = {
    title: "Run handbook",
    description: "Synthetic reference",
    tags: [],
    scope: "workspace",
    archived: false,
  };
  const source = (
    await (
      await page.request.post(api + "/knowledge", {
        headers,
        data: sourceInput,
      })
    ).json()
  ).id;
  const uploaded = await page.request.post(
    api + "/knowledge/" + source + "/documents",
    {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "x-file-name": "handbook.txt",
      },
      data: Buffer.from(
        "A kickoff starts with a written brief and an agreed scope.",
      ),
    },
  );
  const documentId = (await uploaded.json()).id;
  expect(
    (
      await page.request.post(api + "/documents/" + documentId + "/process", {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.goto(route);
  await expect(
    page.getByText("No accessible procedure versions yet."),
  ).toBeVisible();
  await page
    .getByLabel("Procedure title", { exact: true })
    .fill("Client kickoff");
  await page
    .getByRole("textbox", { name: "Procedure instructions", exact: true })
    .fill(
      "Review the kickoff reference and prepare a draft welcome message. Human review is required.",
    );
  await page.getByLabel("Run handbook (workspace)", { exact: true }).check();
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Procedure version published",
  );
  let catalog = await (await page.request.get(api + "/procedures")).json();
  const v1 = catalog.versions[0];
  await page
    .getByRole("combobox", { name: "Procedure", exact: true })
    .selectOption(v1.procedure_id);
  await page
    .getByRole("textbox", { name: "Procedure instructions", exact: true })
    .fill("Revised second version: prepare a separate checklist.");
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(
    page.getByText("Client kickoff · v2", { exact: true }).first(),
  ).toBeAttached();
  await page.getByLabel("Skill name", { exact: true }).fill("Welcome message");
  await page.getByLabel("Pinned procedure version").selectOption(v1.id);
  await page.getByLabel("Draft type").selectOption("message_draft");
  await page.getByRole("button", { name: "Create skill", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Skill created");
  catalog = await (await page.request.get(api + "/procedures")).json();
  const skill = catalog.skills[0];
  expect(skill.version_id).toBe(v1.id);
  await page
    .getByRole("combobox", { name: "Agent skill", exact: true })
    .selectOption(skill.id);
  await page
    .getByLabel("Objective", { exact: true })
    .fill("Prepare client kickoff welcome");
  await page.getByLabel("Additional context").fill("Fictional local project.");
  await page
    .getByLabel("Proposed recipient (optional)")
    .fill("client@example.test");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Create draft run", exact: true })
    .click();
  await expect(page).toHaveURL(/\/runs\//);
  const runId = page.url().split("/").pop()!;
  await expect(page.getByRole("status")).toContainText("queued");
  await page
    .getByRole("button", { name: "Process draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("draft_ready", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("heading", { name: "Blocked proposals" }),
  ).toBeVisible();
  await expect(
    page.getByText("Approval required. Execution disabled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Local drafting; no model tokens", { exact: true }),
  ).toBeVisible();
  const finished = await (
    await page.request.get(api + "/runs/" + runId)
  ).json();
  expect(
    finished.steps.every(
      (step: { status: string }) => step.status === "succeeded",
    ),
  ).toBe(true);
  expect(finished.run.output.draft).toContain("Human review is required");
  expect(finished.run.output.draft).not.toContain("Revised second version");
  expect(finished.run.output.proposals[0].executionAllowed).toBe(false);
  expect(
    (
      await page.request.post(api + "/runs/" + runId + "/execute", {
        headers,
        data: { approved: true },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(api + "/runs", {
        headers,
        data: {
          skillId: skill.id,
          requestKey: randomUUID(),
          input: { objective: "Draft" },
          approved: true,
        },
      })
    ).status(),
  ).toBe(400);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/agent-run.png",
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/agent-run-mobile.png",
    fullPage: true,
  });
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: headers,
  });
  const memberEmail = "sop-reader-" + randomUUID() + "@e2e.example";
  await signUp(member, {
    name: "Procedure Member",
    email: memberEmail,
    password,
  });
  expect((await member.get(api + "/procedures")).status()).toBe(404);
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
  expect(
    (
      await member.post(api + "/procedures", {
        data: {
          procedureId: null,
          title: "Unauthorized",
          instructions: "Publish without owner permission",
          sourceIds: [source],
        },
      })
    ).status(),
  ).toBe(403);
  expect((await member.get(api + "/runs/" + runId)).status()).toBe(404);
  const own = (
    await (
      await member.post(api + "/runs", {
        data: {
          skillId: skill.id,
          requestKey: randomUUID(),
          input: { objective: "Member draft" },
        },
      })
    ).json()
  ).id;
  expect(
    (await member.post(api + "/runs/" + own + "/process", { data: {} })).ok(),
  ).toBe(true);
  expect((await member.get(api + "/runs/" + own)).status()).toBe(200);
  await page.request.patch(api + "/knowledge/" + source, {
    headers,
    data: { ...sourceInput, scope: "private" },
  });
  expect((await member.get(api + "/runs/" + own)).status()).toBe(404);
  expect((await (await member.get(api + "/procedures")).json()).skills).toEqual(
    [],
  );
  await page.request.patch(api + "/knowledge/" + source, {
    headers,
    data: { ...sourceInput, archived: true },
  });
  const failure = (
    await (
      await page.request.post(api + "/runs", {
        headers,
        data: {
          skillId: skill.id,
          requestKey: randomUUID(),
          input: { objective: "Archived-source draft" },
        },
      })
    ).json()
  ).id;
  await page.goto("/w/" + id + "/runs/" + failure);
  await page
    .getByRole("button", { name: "Process draft", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Required knowledge is missing",
    { timeout: 30000 },
  );
  await expect(page.getByRole("status")).toContainText("failed");
  await page.goto(route);
  // Scan the rendered page, not the transient loading state.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Turn your process into a reviewable draft",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(pageErrors).toEqual([]);
  await member.dispose();
});
