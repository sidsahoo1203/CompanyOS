"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client";
import { workspaceSchema, type WorkspaceInput } from "@/lib/validation";
export function WorkspaceForm({
  id,
  initial,
}: {
  id?: string;
  initial?: WorkspaceInput;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const parsed = workspaceSchema.safeParse({
      name: form.get("name"),
      industry: form.get("industry"),
      timezone: form.get("timezone"),
      language: "en",
      retentionDays: Number(form.get("retentionDays")),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setBusy(false);
      return;
    }
    try {
      const result = await requestJson<{ id?: string }>(
        id ? "/api/workspaces/" + id : "/api/workspaces",
        id ? "PATCH" : "POST",
        parsed.data,
      );
      if (id) {
        setMessage("Workspace settings saved.");
        router.refresh();
      } else {
        router.push("/w/" + result.id);
        router.refresh();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="workspace-name">
        Workspace name
        <input
          id="workspace-name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={initial?.name}
          placeholder="Your agency"
        />
      </label>
      <div className="form-grid">
        <label htmlFor="industry">
          Industry
          <input
            id="industry"
            name="industry"
            required
            minLength={2}
            maxLength={80}
            defaultValue={initial?.industry ?? "Digital agency"}
          />
        </label>
        <label htmlFor="timezone">
          Time zone
          <input
            id="timezone"
            name="timezone"
            required
            list="timezones"
            defaultValue={initial?.timezone ?? "UTC"}
            aria-describedby="timezone-help"
          />
        </label>
      </div>
      <datalist id="timezones">
        {[
          "UTC",
          "Asia/Kolkata",
          "America/New_York",
          "America/Los_Angeles",
          "Europe/London",
          "Europe/Berlin",
          "Australia/Sydney",
        ].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p className="hint" id="timezone-help">
        Enter an IANA time zone, such as Asia/Kolkata or Europe/London.
        Language: English.
      </p>
      <label htmlFor="retention">
        Preferred data retention
        <select
          name="retentionDays"
          id="retention"
          defaultValue={initial?.retentionDays ?? 90}
        >
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">365 days</option>
        </select>
      </label>
      <p className="hint">
        This saves your preference. Automatic retention and deletion are not
        available yet.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <button className="button fit" disabled={busy}>
        {busy ? "Saving…" : id ? "Save settings" : "Create workspace"}
      </button>
    </form>
  );
}
