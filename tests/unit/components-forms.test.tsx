// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeFetch } from "./support/fake-fetch";
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: "/w/ws",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => router.pathname,
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href, ...rest }, children),
  };
});
import { AuthForm, SignOutButton } from "@/components/auth-form";
import { JoinForm } from "@/components/join-form";
import { WorkspaceForm } from "@/components/workspace-form";
import { WorkspaceNav } from "@/components/workspace-nav";
import {
  InviteForm,
  RoleControl,
  RemoveControl,
} from "@/components/member-controls";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  router.pathname = "/w/ws";
  window.location.hash = "";
});
// A reply the test can release later, to observe busy states.
function deferred() {
  let release!: (value: { status?: number; body?: unknown }) => void;
  const promise = new Promise<{ status?: number; body?: unknown }>(
    (resolve) => {
      release = resolve;
    },
  );
  return { promise, release };
}
describe("AuthForm", () => {
  it("sign-up sends a trimmed name and normalized email, then opens onboarding", async () => {
    const { sent } = fakeFetch({
      "POST /api/auth/sign-up/email": { body: {} },
    });
    render(<AuthForm mode="sign-up" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "  Riya Shah ");
    await user.type(
      screen.getByLabelText("Email address"),
      " Riya@Agency.Example ",
    );
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/onboarding"),
    );
    expect(sent[0].body).toEqual({
      email: "riya@agency.example",
      password: "correct-horse-1",
      name: "Riya Shah",
    });
    expect(router.refresh).toHaveBeenCalled();
  });
  it("sign-in has no name field, uses current-password and links to sign-up", () => {
    render(<AuthForm mode="sign-in" />);
    expect(screen.queryByLabelText("Your name")).toBeNull();
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(password.getAttribute("minlength")).toBe("12");
    expect(password.getAttribute("aria-describedby")).toBe("password-help");
    expect(
      screen
        .getByRole("link", { name: "Create an account" })
        .getAttribute("href"),
    ).toBe("/sign-up");
  });
  it("shows the server's error as an alert, disables while busy and recovers", async () => {
    const reply = deferred();
    fakeFetch({ "POST /api/auth/sign-in/email": () => reply.promise });
    render(<AuthForm mode="sign-in" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "a@b.example");
    await user.type(screen.getByLabelText("Password"), "wrong-password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Please wait…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    reply.release({
      status: 401,
      body: { error: "Invalid email or password" },
    });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Invalid email or password",
    );
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
  it("sign-out returns to sign-in, or explains a failure", async () => {
    fakeFetch({ "POST /api/auth/sign-out": { body: {} } });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sign-in"));
    cleanup();
    fakeFetch({ "POST /api/auth/sign-out": new TypeError("offline") });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign out failed. Please try again.",
    );
  });
});
describe("JoinForm", () => {
  const token = "ab".repeat(32);
  it("uses the token from the URL fragment, then removes it from the address bar", async () => {
    window.location.hash = "#" + token;
    const replace = vi.spyOn(window.history, "replaceState");
    const { sent } = fakeFetch({
      "POST /api/invitations/accept": { body: { id: "ws1" } },
    });
    render(<JoinForm />);
    await userEvent.click(
      screen.getByRole("button", { name: "Accept invitation" }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/w/ws1"));
    expect(sent[0].body).toEqual({ token });
    expect(replace).toHaveBeenCalledWith(null, "", "/join");
  });
  it("a pasted code takes precedence and is trimmed; failures show an alert", async () => {
    window.location.hash = "#" + "cd".repeat(32);
    const { sent } = fakeFetch({
      "POST /api/invitations/accept": {
        status: 404,
        body: { error: "This item is unavailable, expired, or already used." },
      },
    });
    render(<JoinForm />);
    // Copied codes often carry trailing whitespace; the 64-character limit cuts it.
    await userEvent.type(
      screen.getByLabelText("Invitation code (optional)"),
      token + "  ",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Accept invitation" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already used",
    );
    expect(sent[0].body).toEqual({ token });
    expect(router.push).not.toHaveBeenCalled();
  });
});
describe("WorkspaceForm", () => {
  it("creates a workspace with a numeric retention and opens it", async () => {
    const { sent } = fakeFetch({
      "POST /api/workspaces": { body: { id: "ws9" } },
    });
    render(<WorkspaceForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Workspace name"), "Northwind");
    await user.selectOptions(
      screen.getByLabelText("Preferred data retention"),
      "365",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/w/ws9"));
    expect(sent[0].body).toEqual({
      name: "Northwind",
      industry: "Digital agency",
      timezone: "UTC",
      language: "en",
      retentionDays: 365,
    });
  });
  it("validates the time zone in the browser before sending anything", async () => {
    const { fetch } = fakeFetch({});
    render(<WorkspaceForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Workspace name"), "Northwind");
    await user.clear(screen.getByLabelText("Time zone"));
    await user.type(screen.getByLabelText("Time zone"), "Mars/Olympus");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "IANA time zone",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("edit mode saves with PATCH and confirms with a status message", async () => {
    const { sent } = fakeFetch({
      "PATCH /api/workspaces/ws1": { body: { saved: true } },
    });
    render(
      <WorkspaceForm
        id="ws1"
        initial={{
          name: "Old",
          industry: "Agency",
          timezone: "Asia/Kolkata",
          language: "en",
          retentionDays: 30,
        }}
      />,
    );
    expect((screen.getByLabelText("Time zone") as HTMLInputElement).value).toBe(
      "Asia/Kolkata",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Workspace settings saved.",
    );
    expect(sent[0].body).toMatchObject({ name: "Old", retentionDays: 30 });
    expect(router.refresh).toHaveBeenCalled();
  });
});
describe("WorkspaceNav", () => {
  const current = () =>
    screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent?.replace(/^\d+/, ""));
  it.each([
    ["/w/ws", ["Overview"]],
    ["/w/ws/approvals", ["Approvals"]],
    ["/w/ws/approvals/123", ["Approvals"]],
    ["/w/ws/knowledge/documents/9", ["Knowledge"]],
    ["/w/ws/runs/1", []],
  ])("marks only the current section for %s", (path, expected) => {
    router.pathname = path;
    render(<WorkspaceNav id="ws" />);
    expect(current()).toEqual(expected);
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeTruthy();
  });
});
describe("member controls", () => {
  it("admins can only invite members; owners may also invite admins", () => {
    render(<InviteForm workspaceId="ws" owner={false} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Member",
    ]);
    cleanup();
    render(<InviteForm workspaceId="ws" owner />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Member",
      "Admin",
    ]);
  });
  it("puts the invitation token in the URL fragment, never the query string", async () => {
    const token = "ef".repeat(32);
    const { sent } = fakeFetch({
      "POST /api/workspaces/ws/invitations": { body: { token } },
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<InviteForm workspaceId="ws" owner />);
    await userEvent.type(
      screen.getByLabelText("Teammate’s email"),
      "new@agency.example",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create invitation link" }),
    );
    const link = (await screen.findByLabelText(
      "Invitation link",
    )) as HTMLInputElement;
    expect(link.value).toBe(window.location.origin + "/join#" + token);
    expect(link.value).not.toContain("?");
    expect(sent[0].body).toEqual({
      email: "new@agency.example",
      role: "member",
    });
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(link.value);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });
  it("explains when copying is unavailable", async () => {
    fakeFetch({
      "POST /api/workspaces/ws/invitations": {
        body: { token: "a".repeat(64) },
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn(async () => Promise.reject(new Error("denied"))),
      },
      configurable: true,
    });
    render(<InviteForm workspaceId="ws" owner={false} />);
    await userEvent.type(
      screen.getByLabelText("Teammate’s email"),
      "x@agency.example",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create invitation link" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Copy link" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Copy was unavailable",
    );
  });
  it("role changes stay disabled until a different role is chosen", async () => {
    const { sent } = fakeFetch({
      "PATCH /api/workspaces/ws/members": { body: { saved: true } },
    });
    render(
      <RoleControl workspaceId="ws" userId="u2" name="Riya" role="member" />,
    );
    const save = screen.getByRole("button", {
      name: "Save role",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.selectOptions(
      screen.getByLabelText("Role for Riya"),
      "admin",
    );
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(sent[0].body).toEqual({ userId: "u2", role: "admin" });
  });
  it("removal needs a second, explicit confirmation and can be cancelled", async () => {
    const { fetch, sent } = fakeFetch({
      "DELETE /api/workspaces/ws/members": { body: { removed: true } },
    });
    render(
      <RemoveControl workspaceId="ws" userId="u2" name="Riya" self={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Riya" }));
    expect(
      screen.getByRole("group", { name: "Confirm: Remove Riya" }).textContent,
    ).toContain("loses access on their next request");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove Riya" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm: Remove Riya" }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(sent[0]).toMatchObject({ method: "DELETE", body: { userId: "u2" } });
    expect(router.push).not.toHaveBeenCalled();
  });
  it("leaving sends the user to workspace selection; refusals are shown", async () => {
    fakeFetch({
      "DELETE /api/workspaces/ws/members": { body: { removed: true } },
    });
    render(<RemoveControl workspaceId="ws" userId="me" name="Me" self />);
    await userEvent.click(
      screen.getByRole("button", { name: "Leave workspace" }),
    );
    expect(screen.getByText("You will lose access immediately.")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm: Leave workspace" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/onboarding"),
    );
    cleanup();
    fakeFetch({
      "DELETE /api/workspaces/ws/members": {
        status: 403,
        body: {
          error: "Only the owner can remove admins; admins can remove members.",
        },
      },
    });
    render(
      <RemoveControl
        workspaceId="ws"
        userId="u3"
        name="Admin Two"
        self={false}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Admin Two" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm: Remove Admin Two" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Only the owner",
    );
  });
});
