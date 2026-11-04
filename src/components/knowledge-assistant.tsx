"use client";
import { useState, type FormEvent } from "react";
import type { Citation } from "@/lib/knowledge";
import { requestJson } from "@/lib/client";
import { CitationList } from "./knowledge-panel";
type Answer = { answer: string; status: string; citations: Citation[] };
export function KnowledgeAssistant({ workspaceId }: { workspaceId: string }) {
  const [result, setResult] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await requestJson<Answer>(
          "/api/workspaces/" + workspaceId + "/assistant",
          "POST",
          {
            question: String(new FormData(event.currentTarget).get("question")),
          },
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not retrieve an answer.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>Ask your company knowledge</h2>
        <p className="notice">
          Source-excerpt mode: returns matching text with citations. No
          generative model or external service is connected.
        </p>
        <form className="stack" onSubmit={ask}>
          <label htmlFor="question">
            Your question
            <textarea
              id="question"
              name="question"
              required
              minLength={2}
              maxLength={500}
              placeholder="What is the client onboarding process?"
            />
          </label>
          <button className="button fit" disabled={busy}>
            {busy ? "Finding sources…" : "Find an answer"}
          </button>
        </form>
      </section>
      {busy && <p role="status">Searching sources you can access…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section className="panel" aria-label="Answer">
          <h2>
            {result.status === "insufficient_knowledge"
              ? "Not enough knowledge"
              : "From your sources"}
          </h2>
          <p role="status">{result.answer}</p>
          <CitationList citations={result.citations} />
        </section>
      )}
      {!busy && !result && !error && (
        <p className="muted">
          Ask a question to see cited excerpts. Archived, restricted, failed,
          and unprocessed documents are excluded.
        </p>
      )}
    </>
  );
}
