"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client";
import type {
  KnowledgeSource,
  KnowledgeDocument,
  Citation,
} from "@/lib/knowledge";
import { sourceSchema } from "@/lib/knowledge-validation";
type Library = { sources: KnowledgeSource[]; documents: KnowledgeDocument[] };
export function KnowledgePanel({
  workspaceId,
  manage,
}: {
  workspaceId: string;
  manage: boolean;
}) {
  const base = "/api/workspaces/" + workspaceId;
  const [data, setData] = useState<Library>({ sources: [], documents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [results, setResults] = useState<Citation[] | null>(null);
  async function reload() {
    const response = await fetch(base + "/knowledge", { cache: "no-store" });
    if (!response.ok)
      throw new Error("Knowledge could not be loaded. Try again.");
    const library: Library = await response.json();
    setData(library);
    return library;
  }
  useEffect(() => {
    let active = true;
    fetch(base + "/knowledge", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Knowledge could not be loaded. Try again.");
        return response.json();
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError("Knowledge could not be loaded. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base]);
  const source = data.sources.find((item) => item.id === selected);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const parsed = sourceSchema.safeParse({
      title: form.get("title"),
      description: form.get("description"),
      tags: String(form.get("tags"))
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      scope: form.get("scope"),
      archived: form.get("archived") === "on",
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setBusy(false);
      return;
    }
    try {
      const value = await requestJson<{ id: string }>(
        base + "/knowledge" + (selected ? "/" + selected : ""),
        selected ? "PATCH" : "POST",
        parsed.data,
      );
      await reload();
      setSelected(value.id);
      setResults(null);
      setMessage("Source saved.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save source.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function process(id: string) {
    const response = await fetch(base + "/documents/" + id + "/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Processing failed.");
    if (result.status !== "ready") {
      setMessage("");
      setError(result.message ?? "Processing did not complete.");
    } else setMessage("Document ready for search.");
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("Uploading…");
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File;
    try {
      if (!file?.size || file.size > 5242880)
        throw new Error("Choose a nonempty file no larger than 5 MiB.");
      const response = await fetch(
        base + "/knowledge/" + selected + "/documents",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-file-type": file.type,
          },
          body: file,
          signal: AbortSignal.timeout(20000),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload failed.");
      await reload();
      setMessage("Processing document…");
      await process(result.id);
      await reload();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Upload failed. Retry from the document list.",
      );
      setMessage("");
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    setError("");
    setMessage("Processing document…");
    try {
      await process(id);
      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Processing failed.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const query = String(new FormData(event.currentTarget).get("query"));
    try {
      const value = await requestJson<{ citations: Citation[] }>(
        base + "/knowledge/search",
        "POST",
        { question: query },
      );
      setResults(value.citations);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <p role="status" aria-busy="true">
        Loading knowledge sources…
      </p>
    );
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="knowledge-grid">
        <section className="panel">
          <h2>Sources you can access</h2>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              setError("");
              void reload().catch(() => setError("Refresh failed. Try again."));
            }}
          >
            Refresh library
          </button>
          {!data.sources.length && (
            <p className="muted">
              No knowledge sources yet.{" "}
              {manage
                ? "Create your first source below."
                : "Ask an administrator to add a source you can access."}
            </p>
          )}
          <ul className="source-list">
            {data.sources.map((item) => (
              <li key={item.id}>
                <button
                  className={
                    "source-choice" + (selected === item.id ? " selected" : "")
                  }
                  onClick={() => {
                    setSelected(item.id);
                    setMessage("");
                    setError("");
                  }}
                  aria-pressed={selected === item.id}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.scope} · {item.archived ? "Archived" : "Active"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {manage && (
            <button
              className="button secondary"
              onClick={() => setSelected("")}
            >
              New source
            </button>
          )}
        </section>
        <section className="panel">
          <h2>
            {manage
              ? selected
                ? "Edit source"
                : "Create source"
              : (source?.title ?? "Select a source")}
          </h2>
          {manage ? (
            <form
              key={selected + (source?.scope ?? "")}
              className="stack"
              onSubmit={save}
            >
              <label htmlFor="source-title">
                Source title
                <input
                  id="source-title"
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={source?.title ?? ""}
                />
              </label>
              <label htmlFor="source-description">
                Description
                <textarea
                  id="source-description"
                  name="description"
                  maxLength={1000}
                  defaultValue={source?.description ?? ""}
                />
              </label>
              <label htmlFor="source-tags">
                Tags, separated by commas
                <input
                  id="source-tags"
                  name="tags"
                  defaultValue={source?.tags.join(", ") ?? ""}
                />
              </label>
              <label htmlFor="source-scope">
                Who can access this source?
                <select
                  id="source-scope"
                  name="scope"
                  defaultValue={source?.scope ?? "workspace"}
                >
                  <option value="workspace">All workspace members</option>
                  <option value="admins">Owners and admins</option>
                  <option value="private">Source creator only</option>
                </select>
              </label>
              {selected && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="archived"
                    defaultChecked={source?.archived}
                  />
                  Archive source (exclude from search and answers)
                </label>
              )}
              <button className="button fit" disabled={busy}>
                Save source
              </button>
            </form>
          ) : (
            <p className="muted">
              {source?.description ??
                "Only owners and admins can manage knowledge."}
            </p>
          )}
        </section>
      </div>
      {source && (
        <section className="panel">
          <h2>Documents in {source.title}</h2>
          <p className="hint">
            PDF, DOCX, TXT, CSV or Markdown · 5 MiB maximum. Uploading the same
            filename creates a new version. Original files remain private.
          </p>
          {manage && !source.archived && (
            <form className="upload-form" onSubmit={upload}>
              <label htmlFor="upload-file">
                Document file
                <input
                  id="upload-file"
                  name="file"
                  type="file"
                  accept=".pdf,.docx,.txt,.csv,.md"
                  required
                />
              </label>
              <button className="button" disabled={busy}>
                {busy ? "Working…" : "Upload and process"}
              </button>
            </form>
          )}
          <p className="hint">
            Basic local safety checks are enabled; a full antivirus service is
            not connected. Files containing active content or suspected
            assistant-manipulation instructions are quarantined.
          </p>
          <ul className="document-list">
            {data.documents
              .filter((item) => item.source_id === selected)
              .map((doc) => (
                <li key={doc.id}>
                  <div>
                    <Link
                      href={
                        "/w/" + workspaceId + "/knowledge/documents/" + doc.id
                      }
                    >
                      {doc.filename}
                    </Link>
                    <p className="hint">
                      Version {doc.version} · {Math.ceil(doc.byte_size / 1024)}{" "}
                      KiB · {doc.chunk_count} chunks
                    </p>
                    <span className="badge">{doc.status}</span>
                    {doc.error_code && (
                      <p className="hint">
                        Open document for recovery instructions.
                      </p>
                    )}
                  </div>
                  {manage && !source.archived && doc.status !== "ready" && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void retry(doc.id)}
                    >
                      Process / retry
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {!data.documents.some((item) => item.source_id === selected) && (
            <p className="muted">No documents in this source yet.</p>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Search company knowledge</h2>
        <form className="stack" onSubmit={search}>
          <label htmlFor="knowledge-query">
            Keywords
            <input
              id="knowledge-query"
              name="query"
              required
              minLength={2}
              maxLength={500}
              placeholder="Client onboarding checklist"
            />
          </label>
          <button className="button fit" disabled={busy}>
            Search sources
          </button>
        </form>
        {results !== null &&
          (results.length ? (
            <CitationList citations={results} />
          ) : (
            <p className="notice" role="status">
              No matching passages in the sources you can access.
            </p>
          ))}
      </section>
    </>
  );
}
export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <ol className="citation-list">
      {citations.map((item) => (
        <li key={item.documentId + "-" + item.chunk}>
          <blockquote>{item.quote}</blockquote>
          <Link href={item.href}>
            {item.title} · {item.filename} · v{item.version} · {item.location}
          </Link>
        </li>
      ))}
    </ol>
  );
}
