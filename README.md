# CompanyOS — Milestone 4

CompanyOS is an operations workspace for digital agencies. This milestone is a
real, locally running foundation: accounts, persistent sessions, workspaces,
membership, expiring invitations, roles, a responsive dashboard, and a private
knowledge library with permission-aware search and source citations, versioned
procedures, pinned skills, auditable draft runs, and an approval inbox whose
approved actions are recorded in a local outbox only.
It is not the complete SaaS and is not cleared for public deployment.

## Start locally

Requirements: Node.js 22.16+ (verified on 24.19.0), npm, and an ordinary non-root
OS user. The local database helper includes PostgreSQL binaries; Docker and a
cloud database are not required. Run commands from this directory.

1. Run `npm ci`.
2. In one terminal run `npm run db:local` and keep it open.
   This creates a PostgreSQL cluster bound to 127.0.0.1:55432, restricted runtime
   roles, separate development/test databases, and an ignored `.env.local`
   containing random local credentials.
3. In a second terminal run `npm run db:migrate`.
4. Optionally run `npm run db:seed` for fictional agency accounts.
5. Run `npm run dev` and open http://127.0.0.1:3000.

Sign up normally, or use `founder@studio.example` after seeding. The local seed
password is the value of `SEED_PASSWORD` in your ignored `.env.local` file.
Other synthetic accounts: `admin@studio.example`, `member@studio.example`,
`founder@other.example`. Seed is repeatable and never resets existing passwords.
No email is delivered. Invitation links must be shared manually; the recipient
signs in first and then opens the link with the matching email account.

Stop the web server and database helper with Ctrl+C in their terminals.
Data persists under ignored `work/postgres/`. There is no destructive reset script.
Databases are created as UTF-8 (C collation). Databases created before this
were OS-default WIN1252, which cannot store ₹, Indic scripts or emoji; the helper
warns about them. On 2026-10-09 the local ones were renamed (not deleted) to
`companyos_dev_win1252_backup` and `companyos_test_win1252_backup`, fresh UTF-8
databases were created, migrated and reseeded. To repeat this on another
computer: start the helper, rename the old databases as the PostgreSQL superuser
(`ALTER DATABASE ... RENAME TO ...`), restart the helper, migrate and seed.
Do not share `.env.local`, `work/`, or browser test traces.

## Actual project commands

| Command                        | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `npm run dev`                  | Next development server on loopback                   |
| `npm run build`                | Optimized production compilation                      |
| `npm run start`                | Serve the compiled app on loopback                    |
| `npm run format`               | Apply Prettier formatting                             |
| `npm run format:check`         | Check formatting                                      |
| `npm run lint`                 | ESLint, TypeScript, React Hooks and JSX accessibility |
| `npm run typecheck`            | Generate Next route types, then strict TypeScript     |
| `npm run test`                 | Unit and real PostgreSQL integration tests            |
| `npm run test:unit`            | Unit tests only                                       |
| `npm run test:integration`     | Database integration tests only                       |
| `npm run test:coverage`        | Unit tests with a coverage report (`coverage/`)       |
| `npm run test:e2e`             | Chromium tests against the production build           |
| `npm run db:local`             | Persistent project-local PostgreSQL                   |
| `npm run db:migrate`           | Apply checksummed migrations to development           |
| `npm run db:migrate -- --test` | Apply migrations to isolated test database            |
| `npm run db:seed`              | Idempotent fictional local sample data                |
| `npm audit`                    | Dependency advisory check                             |

Prepare tests with `npm run db:migrate -- --test`.
Install the browser once with `npm exec -- playwright install chromium`.
Run `npm run build` before `npm run test:e2e`.
Browser tests start a separate loopback production server at port 3100 using the
test database. Unit/integration tests also use only `companyos_test`.
Set `PLAYWRIGHT_PORT` to choose another local test port. Set
`PLAYWRIGHT_REUSE_SERVER=true` only when deliberately reusing a CompanyOS server
already started with the isolated test database and matching auth origin.
This opt-in leaves that server running after tests.
Tests create uniquely named fictional records and do not delete existing data.
Artifacts go to ignored `test-results/` and `playwright-report/`; approved
dashboard screenshots go to `docs/screenshots/`.

## Structure and conventions

- `src/app/`: App Router pages, route handlers, global styles.
- `src/components/`: accessible forms and shared navigation.
- `src/lib/`: server-only auth/data services, authorization, validation, safe errors.
- `db/migrations/`: versioned PostgreSQL schema, functions, constraints and RLS.
- `scripts/`: guarded local database, migrations and seed helpers.
- `tests/unit/`, `tests/integration/`, `tests/e2e/`: policy and behavior checks.
- `docs/phase-0.md`: requirements, architecture, data model, milestones and risks.

Strict TypeScript; camelCase functions/variables, PascalCase types/components,
kebab-case module files. Keep server database code out of client bundles.
Use validated inputs and parameterized SQL. Apply Prettier; do not edit an already
applied migration. Add a new migration instead.

## Authentication and isolation

Better Auth stores salted password hashes and opaque database sessions. Roles
are read from current memberships, not copied into client-controlled metadata.
All protected pages and API routes verify the session on the server.

The auth pool can access only authentication tables. The tenant pool uses
`companyos_app`: no superuser, RLS bypass, table ownership, schema creation,
auth-table access, or direct writes. RLS filters reads, including unfiltered
queries. Transaction-local actor/workspace settings cannot persist in the pool.
Fixed-search-path SECURITY DEFINER functions expose narrowly authorized writes
and directory reads. Only the migration owner bypasses RLS; its URL is never
read by request-handling modules. The server is the trusted source of actor
context; database credentials must never be provided to clients.

| Role   | Read workspace | Edit settings | Invite members | Invite admins | Change roles | Remove people       |
| ------ | -------------- | ------------- | -------------- | ------------- | ------------ | ------------------- |
| Owner  | Yes            | Yes           | Yes            | Yes           | Yes          | Admins and members  |
| Admin  | Yes            | Yes           | Yes            | No            | No           | Members (and leave) |
| Member | Yes            | No            | No             | No            | No           | No (can leave)      |

Removing a member (or leaving) deletes only the membership. Access ends on the
person's next request; their pending approval requests expire and invitation
links they issued stop working. Their sources, runs and records stay; private
sources they created become unreadable to everyone, not deleted. The owner
cannot be removed, and owner transfer is not implemented. Invitation acceptance
checks email, expiry, issuer's current role, and atomic single-use consumption.
Only the token hash is stored; links carry the token in a fragment to avoid
server access logs and referrers. A replacement invitation invalidates its predecessor.

Writes require same-origin requests, bounded payloads and schema validation.
Metadata uses JSON; uploads use a bounded raw byte stream.
Auth requests have database-backed rate limits. Local mode aggregates auth
limits for loopback instead of trusting user-supplied proxy headers.
Security headers include nonce-based script CSP, frame denial, and no-referrer.
Production proxy/IP behavior must be designed before deployment.
Minimal append-only security events cover successful workspace and membership
changes, not a complete audit UI or login/failure history. Records show each
person as "Name (email)": display names are user-editable, emails are not.

Unexpected server errors are written as one JSON line each to stderr
(`api.unexpected_error`, `auth.unexpected_error`, `run.engine_failed`,
`document.parser_failed`, `auth.library`), with quoted values and email
addresses redacted and no request bodies, documents or drafts. The client
receives a generic message plus a `reference` that matches the log line.
Expected refusals (4xx) are not logged. There is no log shipping or alerting yet.

## Production release gates

No services have been provisioned or connected. There is no deployment workflow.
Configuration rejects non-loopback services and unknown app modes. Production
builds can run locally; public hosting is intentionally blocked by configuration.

Before public release:

- Implement and verify email ownership and account recovery; current local
  accounts do not establish ownership of an email address.
- Obtain explicit provider/budget/deployment approval, configure TLS and trusted
  proxy headers, and review distributed abuse limits and account quotas.
- Move secrets to a managed secret store, validate least-privilege managed
  database roles, pooling and migrations, and test backup restoration.
- Complete privacy/export/deletion, retention enforcement, monitoring,
  login/error audit coverage, and accessibility/security review.
- Implement remaining milestones and their full acceptance tests.
- Keep data retention labeled as a saved preference until enforcement exists.

Milestone 4 has no generative model calls, integration, outbound email,
billing, financial transaction, or external side-effect capability. Approved
actions are recorded only in the local outbox.

## Knowledge library (Milestone 2)

Open Knowledge in a workspace. Owners/admins create sources, choose visibility
(all members, owners/admins, or the source creator), edit metadata, and archive
sources. Members can search/read only sources they can currently access.
Archived sources remain readable for historical citations but are excluded from
new searches/answers and cannot receive uploads.

Upload PDF, DOCX, UTF-8 TXT, CSV, or Markdown (5 MiB maximum). Raw bytes stay in
private PostgreSQL storage; there are no public file URLs or original downloads.
The same source/filename creates an immutable new version. Search uses only the
latest version; a pending/failed replacement suppresses the older version.
Old citation links still resolve to the original text, subject to current access.

Processing runs in a bounded Node worker, without inherited environment secrets.
Status persists as queued, processing, ready, failed, or quarantined. If the
browser closes before processing starts, use Process / retry. An interrupted
processing lease expires after 30 seconds; retry then. No background daemon is
required. PDF extraction preserves page references; other formats use extracted
text offsets. Scanned PDFs need OCR elsewhere; encrypted/corrupt files fail safely.

The Assistant uses explicitly labeled source-excerpt mode, not a generative model.
PostgreSQL English full-text search matches keywords within authorized passages.
Answers quote exact passages and link to document/version/passage citations.
When no passages match, it states insufficient knowledge. A keyword match does
not establish that every part of a question is answered. No embeddings or model
credentials are required and no document is sent to an external service.

Limits: 50 sources, 100 document versions, 50 MiB raw storage per workspace;
100 PDF pages, 200,000 extracted characters, 500 chunks per document; DOCX
archives bounded to 500 entries/20 MiB expanded. Uploads allow 20/minute and
search/answer requests 60/minute per actor/workspace/operation. Three active
processing leases per workspace; parser deadline 15 seconds.

Basic local checks reject known active-content signatures, unsafe archives and
suspected prompt-injection text. This is not antivirus or complete prompt-injection
detection. Safety does not depend on detecting every instruction: text is rendered
inertly, no model/tools execute it, and permissions are checked in server/SQL code.
Set UPLOAD_REQUIRE_ANTIVIRUS=true to fail closed when no real scanner is configured.
A tested scanner adapter, OS-isolated processing with network denial, deployment
packaging of the parser/dependencies, distributed resource limits, managed storage/
backup/retention, and all earlier release gates remain required before public use.
Worker threads have time/V8-heap limits but are not an OS security sandbox.

See docs/milestone-2-plan.md for decisions and docs/milestone-2-verification.md
for actual verification evidence.

## Procedures, skills and draft runs (Milestone 3)

Open Procedures in a workspace. Owners/admins publish a procedure version
(instructions plus 1–8 required knowledge sources). Versions are immutable;
editing publishes the next version. A skill pins one exact version, a draft type
(source brief or message proposal), the fixed v1 input/output contracts, a
token ceiling, a cost ceiling and a 1–15 second timeout. Owners/admins create,
enable and disable skills. Members can run enabled skills whose sources they can
currently read.

Creating a run saves it as queued; Process draft executes four recorded steps:
Resolve sources → Draft → Validate output → Enforce policy. The default engine,
`local-excerpts-v1`, assembles the objective, procedure instructions and the
latest ready source excerpts. It is not a language model, makes no network
calls, and records 0 tokens and $0. Output is parsed against a strict schema;
citations must come from the authorized source set. Proposed messages are
stored as approval required, execution disabled and blocked, by application code
and again by the database. Request approval from a proposal to review it in
the Approvals inbox (Milestone 4).

Failures are stored with a safe reason and never retried automatically:
missing/archived/unready sources, malformed output, forged citations, invalid
usage, exceeded budgets, timeouts and access changes. Create a new run to retry.
Runs are private to their initiator and disappear if source access is lost.
Limits: 50 procedures, 50 versions each, 100 skills, 1000 runs per workspace,
20 new runs per person per minute, 3 concurrently processing runs.

See docs/milestone-3-plan.md for decisions and docs/milestone-3-verification.md
for actual verification evidence.

## Approvals and the local outbox (Milestone 4)

Open Approvals in a workspace. On a draft run, Request approval turns a blocked
proposal into an approval request. The request snapshots the exact recipient,
message content, run inputs and cited sources, and the server writes the
expected effect. A SHA-256 fingerprint covers all of them. Nothing in the
request can come from the drafting engine's own claims about approval.

- Owners and admins approve or reject requests whose sources they can read.
  Members see only their own requests and can never decide.
- Nobody approves content they wrote, except the workspace owner (so a one-person
  agency can work). Another admin or the owner must approve an admin's request.
- Approving requires ticking "I reviewed…" and echoing the fingerprint that was
  shown. If the content changed meanwhile, the decision is refused as stale.
- Approval also requires one valid recipient email, no hidden/zero-width/
  bidirectional control characters, an enabled skill and an unexpired request
  (48 hours).
- Edit before approval: the requester or an approver edits the recipient or
  content. That creates the next immutable revision (new fingerprint, author and
  expiry) and supersedes the old one, which can never be approved.
- Approving executes in the same database transaction: the exact approved
  snapshot is written once to `app.action_execution` with executor
  `local-outbox-v1`. Nothing is emailed or sent anywhere. A unique constraint
  allows one execution per request; repeating the same idempotency key returns
  the original result, and every other replay is refused.
- Every request, revision, approval, rejection, expiry, execution and refused
  attempt is audited with identifiers and reasons only, never recipients or
  content. Approvers see the audit trail on each request. Decision and edit
  attempts are limited to 30 per person per minute.
- API writes also reject browser requests marked cross-site (Fetch Metadata),
  and pages send cross-origin isolation headers.

Real delivery (Gmail, Slack, Drive) is Milestone 5 and needs separate approval.
See docs/milestone-4-plan.md and docs/milestone-4-verification.md.
