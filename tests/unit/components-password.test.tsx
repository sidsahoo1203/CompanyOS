// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeFetch } from "./support/fake-fetch";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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
import { AuthForm } from "@/components/auth-form";
import {
  ForgotPasswordForm,
  ResetPasswordForm,
} from "@/components/password-forms";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("hosted sign-up with email verification", () => {
  it("asks the user to check their inbox instead of signing in", async () => {
    const { sent } = fakeFetch({
      "POST /api/auth/sign-up/email": { body: { token: null } },
    });
    render(<AuthForm mode="sign-up" verifyEmail />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Riya Shah");
    await user.type(screen.getByLabelText("Email address"), "Riya@A.example");
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Check your inbox at riya@a.example",
    );
    expect(sent[0].body).toMatchObject({ callbackURL: "/onboarding" });
    expect(router.push).not.toHaveBeenCalled();
  });
  it("explains an unverified sign-in and links to password recovery", async () => {
    fakeFetch({
      "POST /api/auth/sign-in/email": {
        status: 403,
        body: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
      },
    });
    render(<AuthForm mode="sign-in" verifyEmail />);
    expect(
      screen
        .getByRole("link", { name: "Forgot password?" })
        .getAttribute("href"),
    ).toBe("/forgot-password");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "a@b.example");
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Verify your email first",
    );
  });
});
describe("password recovery", () => {
  it("requests a reset link and answers without revealing accounts", async () => {
    const { sent } = fakeFetch({
      "POST /api/auth/request-password-reset": { body: { status: true } },
    });
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), " A@B.example ");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "If an account uses that email",
    );
    expect(sent[0].body).toEqual({
      email: "a@b.example",
      redirectTo: "/reset-password",
    });
  });
  it("refuses mismatched passwords locally, then resets with the token", async () => {
    const { sent } = fakeFetch({
      "POST /api/auth/reset-password": { body: { status: true } },
    });
    render(<ResetPasswordForm token="tok_123" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), "new-password-123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new-password-124",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert").textContent).toContain("do not match");
    expect(sent).toHaveLength(0);
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "new-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(sent[0].body).toEqual({
      newPassword: "new-password-123",
      token: "tok_123",
    });
  });
});
