"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client";
export function ForgotPasswordForm({ local = false }: { local?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/auth/request-password-reset", "POST", {
        email: String(data.get("email")).trim().toLowerCase(),
        redirectTo: "/reset-password",
      });
      setSent(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    }
    setBusy(false);
  }
  // The reply never says whether the address has an account.
  if (sent)
    return (
      <div className="stack" role="status">
        <p className="notice">
          If an account uses that email, a reset link is on its way. It works
          once and expires in 1 hour.
          {local &&
            " In local mode the link is printed in the server terminal."}
        </p>
        <p className="hint">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="stack">
      <label htmlFor="email">
        Email address
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Please wait…" : "Send reset link"}
      </button>
      <p className="hint">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </form>
  );
}
export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("password"));
    if (newPassword !== String(data.get("confirm"))) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await requestJson("/api/auth/reset-password", "POST", {
        newPassword,
        token,
      });
      setDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    }
    setBusy(false);
  }
  if (done)
    return (
      <div className="stack" role="status">
        <p className="notice">
          Your password has been changed and every other session was signed out.
        </p>
        <Link className="button" href="/sign-in">
          Sign in
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="stack">
      <label htmlFor="password">
        New password
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          aria-describedby="password-help"
        />
      </label>
      <label htmlFor="confirm">
        Confirm new password
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <p id="password-help" className="hint">
        Use at least 12 characters. A password manager is welcome.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Please wait…" : "Change password"}
      </button>
    </form>
  );
}
