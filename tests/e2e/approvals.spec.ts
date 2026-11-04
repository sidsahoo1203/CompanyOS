import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { signUp } from "./sign-up";
const origin = "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3100");
test.use({ actionTimeout: 15000 });
test("approvals: review exact action, edit, approve to local outbox, reject, deny and replay", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180000);
  const headers = { Origin: origin };
  const password = "Local-Approval-Test!" + randomUUID();
  const pageErrors: string[] = [];
  const ownerEmail = "approver-" + randomUUID() + "@e2e.example";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signUp(
    page.request,
    {
      name: "Approval Owner",
      email: ownerEmail,
      password,
    },
    headers,
  );
  const id = (
    await (
      await page.request.post("/api/workspaces", {
        headers,
        data: {
          name: "Approval Studio",
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
          title: "Welcome handbook",
          description: "Synthetic reference",
          tags: [],
          scope: "workspace",
          archived: false,
        },
      })
    ).json()
  ).id;
  const documentId = (
    await (
      await page.request.post(api + "/knowledge/" + source + "/documents", {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "x-file-name": "welcome.txt",
        },
        data: Buffer.from(
          "Welcome messages confirm the brief, the scope and the first meeting.",
        ),
      })
    ).json()
  ).id;
  await page.request.post(api + "/documents/" + documentId + "/process", {
    headers,
    data: {},
  });
  const version = (
    await (
      await page.request.post(api + "/procedures", {
        headers,
        data: {
          procedureId: null,
          title: "Client welcome",
          instructions: "Draft a welcome message for review and approval.",
          sourceIds: [source],
        },
      })
    ).json()
  ).id;
  const skill = (
    await (
      await page.request.post(api + "/skills", {
        headers,
        data: {
          name: "Welcome message",
          versionId: version,
          operation: "message_draft",
          maxTokens: 8000,
          maxCostMicrousd: 0,
          timeoutMs: 10000,
        },
      })
    ).json()
  ).id;
  const draft = async (
    request: typeof page.request,
    objective: string,
    extra = {},
  ) => {
    const run = (
      await (
        await request.post(api + "/runs", {
          headers,
          ...extra,
          data: {
            skillId: skill,
            requestKey: randomUUID(),
            input: {
              objective,
              context: "Fictional client",
              target: "client@example.test",
            },
          },
        })
      ).json()
    ).id;
    expect(
      (
        await request.post(api + "/runs/" + run + "/process", {
          headers,
          data: {},
        })
      ).ok(),
    ).toBe(true);
    return run;
  };
  const ownerRun = await draft(page.request, "Welcome Northwind");

  // Request approval from the run and review the exact action.
  await page.goto("/w/" + id + "/runs/" + ownerRun);
  await page
    .getByRole("button", { name: "Request approval", exact: true })
    .click();
  await expect(page).toHaveURL(/\/approvals\/[0-9a-f-]+$/);
  const firstId = page.url().split("/").pop()!;
  await expect(page.getByRole("status")).toContainText("Waiting for decision");
  await expect(
    page.getByRole("heading", { name: "Exact action to review" }),
  ).toBeVisible();
  await expect(
    page.getByText("client@example.test", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("pre.approval-content")).toContainText(
    "Objective: Welcome Northwind",
  );
  await expect(
    page.getByText(/Nothing is emailed or sent/).first(),
  ).toBeVisible();
  await expect(
    page
      .locator("blockquote")
      .filter({ hasText: "Welcome messages confirm the brief" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fictional client", { exact: true }),
  ).toBeVisible();
  const approveButton = page.getByRole("button", {
    name: "Approve and record in local outbox",
  });
  await expect(approveButton).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Edit before approval creates a new revision; the old one can never execute.
  const reviewed = page.getByLabel(
    "I reviewed the exact recipient, content, inputs, sources and expected effect.",
  );
  await reviewed.check();
  await expect(approveButton).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Message content", exact: true })
    .fill("Hello Northwind team, welcome aboard. Kickoff is on Monday.");
  await page
    .getByRole("button", { name: "Save as new revision", exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(firstId + "$"));
  const secondId = page.url().split("/").pop()!;
  await expect(page.locator("pre.approval-content")).toHaveText(
    "Hello Northwind team, welcome aboard. Kickoff is on Monday.",
  );
  await expect(page.getByText("Revision 1", { exact: true })).toBeVisible();
  const old = await (
    await page.request.get(api + "/approvals/" + firstId)
  ).json();
  expect(old.request.status).toBe("superseded");
  // A confirmation given for the previous revision must not carry over.
  await expect(reviewed).not.toBeChecked();
  await expect(approveButton).toBeDisabled();
  await reviewed.check();
  await approveButton.click();
  await expect(page.getByRole("status")).toContainText(
    "Approved · recorded in local outbox",
  );
  await expect(
    page.getByRole("heading", { name: "Local outbox record" }),
  ).toBeVisible();
  await expect(
    page.getByText("Recorded in local outbox", { exact: true }),
  ).toBeVisible();
  // Records show the immutable email, not only the editable display name.
  await expect(
    page.getByText("Approval Owner (" + ownerEmail + ")").first(),
  ).toBeVisible();
  const executed = await (
    await page.request.get(api + "/approvals/" + secondId)
  ).json();
  expect(executed.execution).toMatchObject({
    executor: "local-outbox-v1",
    target: "client@example.test",
    payload: "Hello Northwind team, welcome aboard. Kickoff is on Monday.",
    digest: executed.request.digest,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/approval-detail.png",
    fullPage: true,
  });

  // Replays, the superseded revision and cross-site writes are refused.
  const decision = (approvalId: string, digest: string, extra = {}) =>
    page.request.post(api + "/approvals/" + approvalId + "/decision", {
      headers: { ...headers, ...extra },
      data: {
        decision: "approve",
        digest,
        idempotencyKey: randomUUID(),
        confirmed: true,
      },
    });
  expect((await decision(secondId, executed.request.digest)).status()).toBe(
    409,
  );
  expect((await decision(firstId, old.request.digest)).status()).toBe(409);
  expect(
    (
      await decision(secondId, executed.request.digest, {
        Origin: "https://attacker.example",
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await decision(secondId, executed.request.digest, {
        "Sec-Fetch-Site": "cross-site",
      })
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.post(api + "/runs/" + ownerRun + "/execute")).status(),
  ).toBe(404);

  // A member can request but never approve; the owner rejects in the inbox.
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: headers,
  });
  const memberEmail = "requester-" + randomUUID() + "@e2e.example";
  await signUp(member, {
    name: "Approval Member",
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
  const memberRun = await draft(member, "Welcome Contoso");
  const memberRequest = (
    await (
      await member.post(api + "/approvals", {
        data: { runId: memberRun, proposalIndex: 0 },
      })
    ).json()
  ).id;
  const memberDetail = await (
    await member.get(api + "/approvals/" + memberRequest)
  ).json();
  expect(memberDetail.viewer.canDecide).toBe(false);
  expect(memberDetail.audit).toEqual([]);
  const memberAttempt = await member.post(
    api + "/approvals/" + memberRequest + "/decision",
    {
      data: {
        decision: "approve",
        digest: memberDetail.request.digest,
        idempotencyKey: randomUUID(),
        confirmed: true,
      },
    },
  );
  expect(memberAttempt.status()).toBe(403);
  expect((await member.get(api + "/approvals/" + secondId)).status()).toBe(404);

  await page.goto("/w/" + id + "/approvals");
  await expect(
    page.getByRole("heading", { name: "Waiting for decision" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("link", { name: "Send message to client@example.test" })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(memberRequest + "$"));
  await expect(
    page.getByText("Attempt refused", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Decision note (optional)").fill("Wrong client.");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rejected");
  expect(
    (await decision(memberRequest, memberDetail.request.digest)).status(),
  ).toBe(409);
  const rejected = await (
    await member.get(api + "/approvals/" + memberRequest)
  ).json();
  expect(rejected.request).toMatchObject({
    status: "rejected",
    decision_note: "Wrong client.",
  });
  expect(rejected.execution).toBeNull();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/w/" + id + "/approvals/" + secondId);
  await expect(page.getByRole("status")).toContainText("Approved");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/approval-mobile.png",
    fullPage: true,
  });
  const response = await page.request.get("/w/" + id + "/approvals");
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  expect((await anonymous.get(api + "/approvals")).status()).toBe(401);
  expect(pageErrors).toEqual([]);
  await anonymous.dispose();
  await member.dispose();
});
