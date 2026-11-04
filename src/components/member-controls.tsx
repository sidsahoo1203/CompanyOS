"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
export function InviteForm({
  workspaceId,
  owner,
}: {
  workspaceId: string;
  owner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setLink("");
    setCopied(false);
    const form = new FormData(event.currentTarget);
    try {
      const result = await requestJson<{ token: string }>(
        "/api/workspaces/" + workspaceId + "/invitations",
        "POST",
        { email: form.get("email"), role: form.get("role") },
      );
      setLink(window.location.origin + "/join#" + result.token);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Copy was unavailable. Select and copy the link below.");
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label htmlFor="invite-email">
          Teammate’s email
          <input
            id="invite-email"
            type="email"
            name="email"
            maxLength={254}
            autoComplete="off"
            required
          />
        </label>
        <label htmlFor="invite-role">
          Role
          <select id="invite-role" name="role">
            <option value="member">Member</option>
            {owner && <option value="admin">Admin</option>}
          </select>
        </label>
      </div>
      <p className="hint">
        Create a link to share yourself. It expires in 7 days and only works for
        this email address. No email will be sent.
      </p>
      <button className="button fit" disabled={busy}>
        {busy ? "Creating…" : "Create invitation link"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="notice success">
          <p role="status">Invitation created. Share this link privately.</p>
          <label htmlFor="invitation-link">
            Invitation link
            <input
              id="invitation-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button className="button secondary" type="button" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </form>
  );
}
export function RemoveControl({
  workspaceId,
  userId,
  name,
  self,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  self: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = self ? "Leave workspace" : "Remove " + name;
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await requestJson(
        "/api/workspaces/" + workspaceId + "/members",
        "DELETE",
        { userId },
      );
      if (self) router.push("/onboarding");
      else router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      setBusy(false);
    }
  }
  if (!confirming)
    return (
      <button
        type="button"
        className="button danger small"
        onClick={() => setConfirming(true)}
      >
        {label}
      </button>
    );
  return (
    <div className="stack" role="group" aria-label={"Confirm: " + label}>
      <p className="hint">
        {self
          ? "You will lose access immediately."
          : name +
            " loses access on their next request. Their pending approval requests expire and their invitation links stop working. Their content stays."}
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button danger small"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? "Removing…" : "Confirm: " + label}
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function RoleControl({
  workspaceId,
  userId,
  name,
  role,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  role: "admin" | "member";
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson(
        "/api/workspaces/" + workspaceId + "/members",
        "PATCH",
        { userId, role: selected },
      );
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="role-form" onSubmit={submit}>
      <select
        aria-label={"Role for " + name}
        value={selected}
        onChange={(event) =>
          setSelected(event.target.value as "admin" | "member")
        }
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button
        className="button secondary small"
        disabled={busy || selected === role}
      >
        {busy ? "Saving…" : "Save role"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
