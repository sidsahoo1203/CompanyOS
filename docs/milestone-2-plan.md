# Milestone 2: approved implementation plan

Scope: local knowledge sources, secure uploads, document processing and metadata,
workspace/permission-scoped search, cited source excerpts, failure and empty states.
Preserve Milestone 1. No integrations, model calls, agent execution, billing or deployment.

## Decisions

- PostgreSQL stores original files privately as bounded bytea, metadata and extracted chunks.
  No upload is stored under public/ and no caller-supplied path reaches the filesystem.
- Owner/admin users create and manage sources and documents. Source scopes: workspace,
  admins, private (source creator only). Membership is still required for private access.
- Immutable document versions per source/filename. Only the latest version of an active,
  ready source document participates in retrieval. Archive immediately removes retrieval.
- TXT/Markdown/CSV use strict UTF-8. PDF and DOCX are parsed to plain text only.
  Limit 5 MiB/file, 100 document versions and 50 MiB/workspace, 100 PDF pages,
  20 MiB expanded DOCX, bounded chunk output, worker memory and runtime.
- Queued/processing/ready/failed/quarantined states persist. A separate authenticated
  processing request claims a lease. Interrupted work is retried manually after lease expiry.
  No always-running job queue is required. Parser workers receive no credentials.
- Basic local signature/active-content checks are explicitly NOT antivirus certification.
  The scanner interface supports an injected trusted scanner; required-antivirus mode fails
  closed if no scanner is configured. No scanner service is connected.
- PostgreSQL full-text search (English) is sufficient for this bounded MVP. No embeddings
  or vector service is needed yet. Permissions and source filtering precede result limits.
- Assistant returns exact cited excerpts, not model-written assertions. It states when
  knowledge is insufficient and makes no inferences or tool calls. Document instructions
  are inert text; obvious prompt-injection patterns are quarantined as defense in depth.
- Citation links resolve a document version and chunk, with authorization checked again.
  No raw HTML/Markdown execution or original-file downloads.

## Acceptance

Unit tests: type/signature/name/size validation, chunking, parser safeguards,
injection checks, deterministic citations and abstention.
PostgreSQL tests: tenant/source ACLs and all storage layers, versioning, archives,
live permission changes, failed/quarantined processing, citations and quota/lease rules.
Browser: upload → processing → ready → search → cited excerpt; failures, empty states,
restricted member access, mobile layout and accessibility.
Run formatting, lint, types, all tests, production build and dependency audit.
Report exact commands and results, plus limitations. Stop after Milestone 2.
