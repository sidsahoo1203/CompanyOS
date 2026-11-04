# Milestone 2 verification

Verified locally on 2026-10-04, Windows, Node.js 24.19.0, PostgreSQL 18.4.
Scope: knowledge-source management, private uploads, processing/metadata,
workspace and source permissions, search, cited source excerpts, and UI states.
Milestone 1 behavior is retained. No production service, model, integration,
billing, agent executor, or public deployment was connected.

## Delivered

- Knowledge and Assistant routes/navigation plus permission-checked document
  citation pages. Source title, description, tags, visibility, and archive controls.
- PDF/DOCX/TXT/Markdown/CSV uploads: filename/size/MIME/signature checks, bounded
  request streaming, private database bytes, SHA-256, immutable versions.
- Persistent queued/processing/ready/failed/quarantined states, processing leases,
  retry controls, safe failure messages, chunk metadata and page/text locations.
- A parser worker with an empty inherited environment, V8 heap limits and a
  15-second deadline. DOCX expansion/path/entity/active-content checks and PDF
  page/text/active-content checks. Basic local signatures and a fail-closed
  required-antivirus switch; no full antivirus integration.
- Migration 002 adds source/document/chunk/rate tables, composite tenant keys,
  RLS, authorized definer functions, quotas, full-text indexes and audit events.
- Permission filtering before ranking/limits. New retrieval uses only the latest
  ready version of active sources; an unfinished replacement suppresses the old
  version. Archived and previous versions remain readable through historical
  citations only when the current viewer still has access.
- Assistant answers are explicitly source-excerpt mode: exact stored quotes,
  document/version/passage links, and an insufficient-knowledge response when
  no authorized passage matches. No generative answer, embeddings, or tool calls.
- README and AGENTS.md updated with scope, commands, safety boundaries and gates.
  Parser dependencies pinned in package.json/package-lock.json.
- Browser harness accepts a validated alternate loopback port and explicit
  reuse of an already running test server.

## Commands and observed results

All commands ran from the companyos repository. Windows uses npm.cmd to avoid
PowerShell script-policy ambiguity.

| Command                                                                                 | Observed result                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| npm.cmd install --cache ./work/npm-cache --save-exact pdfjs-dist fflate fast-xml-parser | Installed; 0 known vulnerabilities reported                                                       |
| npm.cmd run db:migrate                                                                  | 002_knowledge.sql applied to development; subsequent run reported both migrations already applied |
| npm.cmd run db:migrate -- --test                                                        | 002_knowledge.sql applied to isolated test database; subsequent run reported both already applied |
| npm.cmd run format                                                                      | Exit 0                                                                                            |
| npm.cmd run format:check                                                                | Exit 0; all matched files use Prettier style                                                      |
| npm.cmd run lint                                                                        | Exit 0; no warnings/errors                                                                        |
| npm.cmd run typecheck                                                                   | Exit 0; route types generated and TypeScript passed                                               |
| npm.cmd run test                                                                        | Exit 0; 4 files, 60 tests passed                                                                  |
| npm.cmd run build                                                                       | Exit 0; optimized compilation, TypeScript and route generation passed                             |
| npm.cmd audit --cache ./work/npm-cache                                                  | Exit 0; 0 known vulnerabilities                                                                   |
| npm.cmd run test:e2e with the environment below                                         | Exit 0; 4 Chromium tests passed in 43.6 seconds                                                   |

Successful final browser invocation in PowerShell:

```powershell
$env:PLAYWRIGHT_PORT = '3101'
$env:PLAYWRIGHT_REUSE_SERVER = 'true'
npm.cmd run test:e2e
```

The reused server had been started by the previous Playwright invocation using
the current production build, companyos_test database, test auth role and the
matching loopback auth origin. No production credentials were used.

## Coverage and evidence

60 unit/integration tests include the original 20 plus 40 new cases:
25 validation/parser cases and 15 PostgreSQL knowledge cases.

- Unsafe names, disallowed extensions, empty/oversized files, MIME/magic mismatch,
  invalid UTF-8/binary text, chunked-body size enforcement and strict schemas.
- Real synthetic PDF and DOCX extraction; TXT/CSV/Markdown chunking; corrupt,
  empty and excessively long content; macro/unsafe-path/oversized/entity DOCX;
  active-content signatures, instruction quarantine, scanner failure/required
  mode, and worker timeout.
- Cross-tenant metadata/chunks/document IDs/uploads/processing and unfiltered RLS
  reads; direct raw-byte/mutation restrictions; member write denial; private and
  admin-only sources; immediate role revocation for retrieval and citation access.
- Exact quote/location/version/link correspondence; absent/restricted/stop-word
  queries abstain; immutable previous citations; latest-version suppression;
  archiving; persisted processing failures/quarantine; exclusive leases, stale
  completion denial and retry; audit content minimization; retrieval rate limits.

The 4 browser scenarios exercise:

- Existing signup, workspace, invitation, roles, settings, signout and API boundaries.
- Existing keyboard entry and mobile workspace flow.
- Knowledge empty state, source creation/metadata, actual file upload/processing,
  ready and corrupt-file failure states, search, assistant excerpts, citation
  navigation, insufficient knowledge, invalid upload/CSRF/schema rejection,
  outsider/member restrictions, visibility change, and archive exclusion.
- Axe scans on library, assistant, citation and mobile pages returned no violations.
  Layout checks passed at 390px and 320px; no browser page errors were captured.

Screenshots of synthetic data: docs/screenshots/knowledge-library.png and
docs/screenshots/knowledge-mobile.png. Both were visually inspected.
The full-page screenshots can include the offscreen fixed skip link when captured
after scrolling; keyboard behavior and actual viewport overflow were tested
separately. No real customer documents were used.

## Issues encountered and limits

The first migration attempt failed on a PL/pgSQL CASE expression. It was fixed
before application; successful applied migration checksums were then preserved.
Lint initially flagged intentional control-character regexes; narrow explanatory
directives fixed that. One browser assertion initially matched both the app error
and Next.js's route announcer; scoping it to main fixed the test ambiguity.

Windows test-server teardown lingered after the tests. Explicit server reuse
allowed the final runner to finish with exit 0. Automatic approval review rejected
forced cleanup because process ownership could not be independently verified.
The local test servers were left running; no alternative termination was attempted.
The managed teardown path remains unverified as a clean shutdown on this host.

Next emitted a non-failing warning about ignoring an unrelated package-lock.json
outside this Git repository. Browser tooling emitted a non-failing color-variable
warning. Neither prevented checks from passing.

This is a verified local MVP, not public-production clearance:

- Full antivirus/content disarm is not configured. Signature and instruction
  checks are incomplete defense in depth and can have false positives.
- Worker threads do not provide OS/network isolation; V8 heap limits do not cap
  all native/buffer memory. Harden parsing and package its runtime for the chosen
  managed deployment before accepting public uploads.
- No OCR, semantic/vector search, or generative answer synthesis. English keyword
  matches do not establish semantic correctness or complete support for a question.
- No automatic background queue; interrupted uploads/processes use manual retry.
- Storage/retention/backup operations, distributed abuse limits, email ownership,
  recovery, and earlier README production gates remain.
- No external penetration test, sustained load test, real antivirus verification,
  Firefox/WebKit run, or production-provider deployment was performed.

Stopped after Milestone 2.
