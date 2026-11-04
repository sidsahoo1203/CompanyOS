"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
export function JoinForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const token = String(
      form.get("token") || window.location.hash.slice(1),
    ).trim();
    try {
      const result = await requestJson<{ id: string }>(
        "/api/invitations/accept",
        "POST",
        { token },
      );
      window.history.replaceState(null, "", "/join");
      router.push("/w/" + result.id);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p>
        Accept the invitation from the link you opened. You must be signed in
        with the email address it was created for.
      </p>
      <label htmlFor="token">
        Invitation code (optional)
        <input
          id="token"
          name="token"
          autoComplete="off"
          maxLength={64}
          aria-describedby="token-help"
        />
      </label>
      <p className="hint" id="token-help">
        Leave this blank to use your invitation link, or paste its 64-character
        code.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Joining…" : "Accept invitation"}
      </button>
    </form>
  );
}
