import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { signUp } from "./sign-up";
const origin = "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3100");
const password = "Local-Test-Only!" + randomUUID();
const input = {
  name: "Boundary workspace",
  industry: "Digital agency",
  timezone: "UTC",
  language: "en",
  retentionDays: 90,
};
async function signup(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const submit = page.getByRole("button", {
    name: "Create account",
    exact: true,
  });
  await submit.click();
  // The shared local sign-up limit (10/minute) can be reached when suites run
  // back to back; wait out the window once rather than weakening the limit.
  const limited = page
    .getByRole("alert")
    .filter({ hasText: "Too many requests" });
  await Promise.race([page.waitForURL(/onboarding/), limited.waitFor()]).catch(
    () => undefined,
  );
  if (await limited.isVisible()) {
    test.info().setTimeout(test.info().timeout + 75000);
    await page.waitForTimeout(61000);
    await submit.click();
  }
  await expect(page).toHaveURL(/onboarding/);
}
test("desktop: signup, workspace, invitation, roles, settings and signout", async ({
  page,
  browser,
}) => {
  const suffix = randomUUID();
  const email = "owner-" + suffix + "@e2e.example";
  const memberEmail = "member-" + suffix + "@e2e.example";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signup(page, "Agency Owner", email);
  await page.getByLabel("Workspace name").fill("Northstar Test Agency");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A place to work together." }),
  ).toBeVisible();
  const workspaceUrl = page.url();
  const workspaceId = workspaceUrl.split("/").pop()!;
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/desktop-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByLabel("Teammate’s email").fill(memberEmail);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const linkField = page.getByLabel("Invitation link", { exact: true });
  await expect(linkField).toBeVisible();
  const inviteUrl = await linkField.inputValue();
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signup(member, "Agency Member", memberEmail);
  await member.goto(inviteUrl);
  await member.getByRole("button", { name: "Accept invitation" }).click();
  await expect(member).toHaveURL(workspaceUrl);
  await member.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    member.getByText(
      "Only the owner or an administrator can change workspace settings.",
    ),
  ).toBeVisible();
  const blocked = await member.request.patch("/api/workspaces/" + workspaceId, {
    headers: { Origin: origin },
    data: input,
  });
  expect(blocked.status()).toBe(403);
  const replay = await member.request.post("/api/invitations/accept", {
    headers: { Origin: origin },
    data: { token: inviteUrl.split("#")[1] },
  });
  expect(replay.status()).toBe(404);
  await page.reload();
  await page.getByLabel("Role for Agency Member").selectOption("admin");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("button", { name: "Save role" })).toBeDisabled();
  await member.reload();
  await expect(
    member.getByRole("button", { name: "Save settings" }),
  ).toBeVisible();
  await member.getByLabel("Workspace name").fill("Northstar Renamed");
  await member.getByRole("button", { name: "Save settings" }).click();
  await expect(member.getByRole("status")).toHaveText(
    "Workspace settings saved.",
  );
  expect((await new AxeBuilder({ page: member }).analyze()).violations).toEqual(
    [],
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto(workspaceUrl);
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(
    page.getByRole("link", { name: /Northstar Renamed/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await memberContext.close();
});
test("API: authentication, tenant isolation, CSRF, validation, safe errors and headers", async ({
  playwright,
}) => {
  // Sign-ups may wait out the shared local rate-limit window (up to ~66 s).
  test.setTimeout(180000);
  const first = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const second = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  expect((await anonymous.get("/api/workspaces")).status()).toBe(401);
  for (const [index, context] of [first, second].entries())
    await signUp(context, {
      name: "API User",
      email: index + "-" + randomUUID() + "@e2e.example",
      password,
    });
  const created = await first.post("/api/workspaces", { data: input });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).id;
  expect((await second.get("/api/workspaces/" + id)).status()).toBe(404);
  expect(
    (await second.patch("/api/workspaces/" + id, { data: input })).status(),
  ).toBe(404);
  const spoof = await first.patch("/api/workspaces/" + id, {
    headers: { Origin: "https://attacker.example" },
    data: input,
  });
  expect(spoof.status()).toBe(403);
  expect(
    (
      await first.post("/api/workspaces", { data: { ...input, role: "owner" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await first.post("/api/workspaces", {
        data: { ...input, name: "x".repeat(18000) },
      })
    ).status(),
  ).toBe(413);
  const response = await first.get("/api/workspaces/" + id);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(JSON.stringify(await spoof.json())).not.toMatch(
    /postgres|password|token/i,
  );
  const evilAuth = await first.post("/api/auth/sign-out", {
    headers: { Origin: "https://attacker.example" },
    data: {},
  });
  expect(evilAuth.status()).toBe(403);
  await first.dispose();
  await second.dispose();
  await anonymous.dispose();
});
test("mobile: keyboard access, real workspace flow, responsive layout and accessibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-up");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await signup(page, "Mobile Owner", "mobile-" + randomUUID() + "@e2e.example");
  await page.getByLabel("Workspace name").fill("Mobile Studio");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A place to work together." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/mobile-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Workspace name").fill("Mobile Studio Updated");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Workspace settings saved.",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
