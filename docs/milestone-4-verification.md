# Milestone 4 verification

Verified locally on 2026-10-09, Windows 11, Node.js 24.19.0, npm 11.2.0,
PostgreSQL 18.4 (project-local, now UTF-8). Scope: approval inbox, request
details, approve/reject, edit before approval, idempotency and replay
protection, audit events, permission enforcement and security hardening.
Milestones 1–3 are retained. No production integration, model provider,
outbound email, deployment or external side effect was connected or performed.
No Git repository commits were made.

## Delivered

- Migration 006: `approval_request` (immutable revisions, snapshot of kind,
  target, content, run inputs, cited sources, server-derived expected effect,
  SHA-256 digest, 48-hour expiry) and `action_execution` (one per request,
  unique idempotency key per workspace, executor `local-outbox-v1`). RLS:
  approvers see requests whose sources they can read; requesters see their own.
  Definer functions `request_approval`, `edit_approval`, `decide_approval`,
  `expire_approvals`. Audit actions extended; audit results now allow `denied`
  and risk allows `high`.
- Execution gate (`decide_approval`): approve only when the actor is owner/admin,
  not the author (unless owner), the request is the pending unexpired latest
  revision, the echoed digest matches, the skill is enabled, the recipient is
  one valid email, no hidden/bidi control characters are present, and the
  idempotency key is unused. The exact snapshot is then recorded in the same
  transaction. Refusals return an outcome, so the denial audit commits. The
  service layer re-checks the role and executed digest inside the transaction
  and rolls back on any mismatch.
- Migration 007 redefines the hidden-character check with ASCII escapes (see
  issues below); behavior is identical.
- UI: Approvals navigation, inbox (waiting/history), detail page with the exact
  action box (recipient, content, expected effect, fingerprint), run inputs,
  cited sources, review confirmation, approve/reject with note, edit-as-revision,
  decision record, local-outbox evidence, revision history and audit trail.
  Request approval control on run proposals. The detail view remounts per
  revision so a confirmation never carries over to new content.
- Hardening: Fetch Metadata check (cross-site API writes refused), COOP, CORP
  and X-Permitted-Cross-Domain-Policies headers, strict Zod schemas that reject
  client-supplied authority fields, `approvals:decide` permission, rate limit of
  30 decision/edit attempts per person per minute, and a loading screen heading
  (accessibility).
- UTF-8 databases: `scripts/local-db.mjs` now creates UTF-8/C databases and warns
  about non-UTF-8 ones.

## Database encoding change (approved by the user)

Migration 006 failed on the existing databases: they were WIN1252 (Windows
default), which cannot store ₹, Indic scripts, emoji or the characters the
hidden-character check names. Both contained only fictional seed and test data
(4 `*.example` users in development). With the user's approval they were renamed,
not deleted, to `companyos_dev_win1252_backup` and
`companyos_test_win1252_backup`. Fresh UTF-8 databases were created by the
helper, migrations 001–007 applied, and the fictional seed reapplied. A direct
check confirmed ₹, Devanagari and emoji are stored and accepted, while U+200B,
U+202E, U+2060, U+2066, U+FEFF, BEL and DEL are rejected.

## Commands and observed results

All commands ran from `outputs/companyos` with the database helper running.

| Command                                  | Observed result                                                 |
| ---------------------------------------- | --------------------------------------------------------------- |
| npm.cmd run db:local                     | UTF-8 databases created; ready on 127.0.0.1:55432               |
| node scripts/migrate.mjs (and `--test`)  | 001–007 applied to both; repeat runs report all already applied |
| npm.cmd run db:seed                      | Four fictional accounts recreated in development                |
| npm.cmd run format:check                 | Exit 0                                                          |
| npm.cmd run lint                         | Exit 0 (after the fixes below)                                  |
| npm.cmd run typecheck                    | Exit 0                                                          |
| npm.cmd run test                         | Exit 0; 8 files, 119 tests passed                               |
| npm.cmd run build                        | Exit 0; includes 4 approval API routes and 2 approval pages     |
| npm.cmd run test:e2e                     | Exit 0; 6 Chromium tests passed in 2.6 minutes                  |
| npm.cmd audit / npm.cmd audit --omit=dev | Exit 0; 0 known vulnerabilities in both                         |

The Playwright-managed server on port 3100 shut down after the run.

## Coverage

119 unit/integration tests: the previous 98 plus 7 unit and 14 PostgreSQL
approval tests. Every refusal test counts executions with the migration owner
(bypassing RLS) and asserts zero.

Rejected or unauthorized actions cannot execute:

- Members cannot approve via the service (403) or by calling the SQL function
  directly (`forbidden`); foreign tenants get 404; the refusal is audited.
- A rejected request cannot later be approved, edited or rejected again.
- A superseded revision and a stale digest are refused; only the exact reviewed
  revision executes, and the outbox holds exactly the edited recipient/content.
- Admins cannot approve their own content; another admin or the owner can.
- Replays: same approver and key returns the original execution; any other key,
  approver or a key used elsewhere is refused. Three concurrent approvals by
  different approvers produce exactly one execution.
- Expired requests are refused and become expired; a revision starts fresh.
- Placeholder or multiple recipients and hidden characters (via the service,
  direct SQL, and content injected into the stored snapshot) are refused.
- A disabled skill or revoked source access blocks the decision and hides the
  request.
- The runtime role cannot update requests, insert executions or delete audit
  events.
- Audit events cover requested, edited, approved, rejected, expired, denied and
  executed, with no recipients or content.
- The 31st attempt within a minute is rate limited.

Unit: the decision schema needs confirmation, digest and idempotency key and
rejects authority fields; the edit schema needs one valid recipient and safe
text while accepting ₹/Devanagari/emoji; only owners/admins can decide; every
SQL outcome maps to a safe client error; the TypeScript and SQL hidden-character
classes are identical (read from migration 007).

Mutation check: the SQL recipient check was temporarily replaced in the test
database with one that accepts anything; the hidden-character/recipient test
failed as expected, and the original function definition was restored and
confirmed byte-identical.

Browser (Chromium): request approval from a run, see the exact recipient,
content, expected effect, sources and inputs; approval stays disabled until
confirmed; edit creates revision 2 and clears the confirmation; approve records
the local-outbox entry with the matching digest; replay, superseded revision,
foreign Origin and `Sec-Fetch-Site: cross-site` are refused; `/execute` is 404;
a member can request but gets 403 on approval and cannot see others' requests;
the owner rejects in the inbox and later approval returns 409 with no execution;
anonymous access returns 401; COOP header present; Axe scans report zero
violations; no horizontal overflow at 390px and 320px; no page errors.
Screenshots docs/screenshots/approval-detail.png and approval-mobile.png
(synthetic data) were inspected.

## Issues found and resolved

- WIN1252 databases (above).
- Invisible characters in source: tool-written regexes stored the zero-width and
  bidi characters literally instead of as escapes, in
  `src/lib/approval-contracts.ts` and migration 006 line 64. The TypeScript was
  rewritten with ASCII escapes. Migration 006 was already applied, so per project
  rules it was not edited; migration 007 redefines the function with escapes.
  A scan of src, db, scripts, tests and docs finds no other such characters; the
  inert line in 006 remains for checksum integrity.
- Lint: the intentional control-character regex uses a narrow
  `no-control-regex` exception, matching existing knowledge validation code.
- Browser suite: sign-ups exceeded the deliberate local limit of 10 per minute
  (the knowledge test received 429). A test helper now waits out the server's
  `X-Retry-After` window once; the production limit is unchanged.
- An Axe scan in the agents test could run during the loading screen, which had
  no heading. The loading screen now has an h1, and the test waits for the page
  heading.
- Restarting the database helper by stopping its background task left an
  orphaned PostgreSQL worker holding the port without a lock file. That worker
  and a hung migration process from this session were stopped; the helper then
  started cleanly. Stop the helper with Ctrl+C in its own terminal.

## Limits and unverified items

- The executor is local only. Real delivery (Milestone 5) must reuse the same
  gate, add provider idempotency, revocation, retries and delivery evidence.
- Separation of duties is limited to "not the author"; the owner may self-approve.
  Multi-approver rules are not implemented.
- Expiry is enforced on read and on decision; there is no background sweeper.
- Audit trail is shown per request to approvers; there is no workspace-wide
  audit browser or export.
- Rate limits are database-backed per person; distributed abuse limits remain a
  release gate.
- Not verified: Firefox/WebKit, physical devices, load or penetration testing,
  backup restoration. Earlier README release gates remain.
- Non-failing warnings: Next.js ignored an unrelated package-lock.json in the
  user's home directory; Playwright printed a NO_COLOR/FORCE_COLOR warning.

Stopped after Milestone 4.
