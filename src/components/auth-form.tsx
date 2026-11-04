"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signup = mode === "sign-up";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(
        "/api/auth/" + (signup ? "sign-up" : "sign-in") + "/email",
        "POST",
        {
          email: String(data.get("email")).trim().toLowerCase(),
          password: data.get("password"),
          ...(signup ? { name: String(data.get("name")).trim() } : {}),
        },
      );
      router.push("/onboarding");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      {signup && (
        <label htmlFor="name">
          Your name
          <input
            id="name"
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={80}
          />
        </label>
      )}
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
      <label htmlFor="password">
        Password
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={12}
          maxLength={128}
          aria-describedby="password-help"
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
        {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
      </button>
      <p className="hint">
        {signup ? "Already have an account?" : "New to CompanyOS?"}{" "}
        <Link href={signup ? "/sign-in" : "/sign-up"}>
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    try {
      await requestJson("/api/auth/sign-out", "POST", {});
      router.push("/sign-in");
      router.refresh();
    } catch {
      setError("Sign out failed. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="button ghost" onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
