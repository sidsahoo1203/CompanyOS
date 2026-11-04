# AGENTS.md — CompanyOS

## Purpose
Approval-driven operations workspace for 5–50-person digital agencies.
Implemented (Milestones 1–4, local only): accounts and workspaces with
owner/admin/member roles; private knowledge sources with cited keyword search;
versioned procedures, pinned skills and draft runs; an approval inbox whose
approved actions are recorded only in a local outbox. Plans and evidence:
`docs/phase-0.md`, `docs/milestone-*-plan.md`, `docs/milestone-*-verification.md`.

Stack: Next.js 16 App Router, React 19, strict TypeScript, PostgreSQL 18
(project-local via embedded-postgres), `pg`, Better Auth, Zod. Package manager:
npm with `package-lock.json` and exact versions (`.npmrc` save-exact). Node >= 22.16.

## Important directories
- `src/app/` — pages, `api/` route handlers, `globals.css`. `src/proxy.ts` sets CSP.
- `src/components/` — client UI components.
- `src/lib/` — server-only services (`import "server-only"`), auth, db, permissions,
  Zod contracts, safe errors. `*-contracts.ts` files are shared with the client.
- `db/migrations/` — numbered SQL: schema, RLS policies, SECURITY DEFINER functions.
- `scripts/` — local database helper, migration runner, seed, parser worker, test server.
- `tests/unit/`, `tests/integration/` (real PostgreSQL), `tests/e2e/` (Playwright).
- `docs/` — requirements, plans, verification reports, screenshots.
- `work/` — ignored local database and runtime state. Never commit or share.

## Development commands
- `npm ci` — install dependencies.
- `npm run db:local` — start local PostgreSQL on 127.0.0.1:55432; keep it running.
  First run creates UTF-8 databases and an ignored `.env.local`. Stop with Ctrl+C.
- `npm run db:migrate` / `npm run db:migrate -- --test` — apply migrations to the
  development / isolated test database.
- `npm run db:seed` — idempotent fictional accounts (development only).
- `npm run dev` — dev server at http://127.0.0.1:3000.
- `npm run start` — serve a production build locally.
- `npm run test:serve` — production server against the test database only.

## Quality commands
- Format: `npm run format` (write), `npm run format:check` (verify). Prettier.
- Lint: `npm run lint` (ESLint: TypeScript, React Hooks, jsx-a11y).
- Types: `npm run typecheck` (`next typegen` then `tsc --noEmit`).
- Tests: `npm run test` (unit + integration), `npm run test:unit`,
  `npm run test:integration`. Requires the test migration.
- Coverage: `npm run test:coverage` (unit tests; see `docs/unit-testing.md`).
- Browser: `npm exec -- playwright install chromium` once, then `npm run build`,
  then `npm run test:e2e` (Chromium on port 3100; `PLAYWRIGHT_PORT` overrides).
- Build: `npm run build`.
- Dependencies: `npm audit`.

## Conventions
- camelCase functions/variables, PascalCase components/types, kebab-case files.
- Prettier defaults with double quotes and trailing commas; import via `@/`.
- Validate every boundary input with strict Zod schemas; parameterized SQL only.
- Keep database code server-only and out of client bundles.
- Never edit an applied migration (checksums are enforced); add a new one.
- Write invisible or control characters as escapes, never literally.
- UI must work with keyboard and screen readers, at 320px width, and have
  loading, empty and error states.

## Authentication and authorization
- Better Auth email/password with database sessions; verify the session
  server-side on every protected page and API route (`api()` in `src/lib/http.ts`).
- Derive the actor from the session. Never accept user IDs, roles, approvals,
  budgets or permissions from requests or model output.
- Roles are fixed: owner, admin, member (`src/lib/permissions.ts`). Read current
  membership on every request; deny by default. Only the owner changes roles; the
  owner cannot be demoted or removed. Removal (`app.remove_member`) follows
  invitation rules (owner removes anyone else, admins remove members, anyone else
  may leave) and must fail closed: pending approvals expire, issued invites end.
- Display names are user-editable; show people as name plus email
  (`personLabel`) and resolve them with `app.workspace_people`.
- Enforce permissions in both the service layer and SQL functions; test the
  database boundary directly, not just hidden UI.
- Writes require same-origin `Origin`, no cross-site Fetch Metadata, JSON (or a
  bounded octet stream for uploads) and bounded bodies.

## Data isolation
- Every tenant table has `workspace_id`; child foreign keys include it.
- Use `asActor()` for transaction-local actor/workspace context, RLS, and the
  restricted `companyos_app` role. Writes go only through SECURITY DEFINER
  functions with fixed `search_path`, explicit checks and no PUBLIC execute.
- The auth pool (`companyos_auth`) and tenant pool stay separate. The migration
  account is never used by request handlers.
- Source-level ACLs apply before search and ranking. Runs and approvals stay
  hidden when the viewer loses access to any underlying source.

## Secrets
- Never commit or print `.env*` (except `.env.example`), `work/`, passwords,
  tokens, test traces or private data. Never send credentials to browsers,
  models or logs.
- Invitation tokens are one-time bearer secrets: store only hashes, bind to
  email, expire, consume atomically, and keep them out of audit metadata.
- Audit metadata holds identifiers and reasons only, never content or recipients.
- Log unexpected failures only through `src/lib/log.ts` (`logUnexpected`): one
  redacted JSON line plus a reference returned to the client. Never log request
  bodies, documents, drafts, tokens or credentials; no raw `console` calls.

## AI output and untrusted content
- Uploaded documents, run inputs and engine output are untrusted data, never
  instructions or permissions. Render as inert text; never serve originals.
- Validate engine output against strict schemas and size limits; citations must
  come from the authorized retrieval set. Enforce budgets, deadlines and
  idempotency in code; never auto-retry runs.
- The engine is local excerpt assembly (`local-excerpts-v1`), not an LLM. Adding
  a model provider requires explicit approval.

## External side effects
- Proposed actions stay blocked until an approval request is decided via
  `app.decide_approval`. Never add an execution path that bypasses it.
- Approval requires owner/admin; no self-approval except the owner; the exact
  reviewed digest; an idempotency key; an unexpired latest revision; a valid
  single recipient; and no hidden characters. Edits create new revisions.
- The only executor is `local-outbox-v1` (records in PostgreSQL). Real
  integrations, sending messages or email, payments and anything outside this
  computer need explicit user approval first.

## Deployment restrictions
- No deployment configuration exists. `src/lib/env.ts` requires
  `APP_MODE=local`, loopback service hosts and the restricted database roles.
  Do not bypass it.
- Do not deploy, publish, provision paid services, connect production systems
  or use production credentials without explicit user approval.
- Public release gates (README): email verification and recovery, TLS and proxy
  configuration, managed secrets, backups, antivirus and isolated parsing,
  monitoring, privacy workflows, and security/accessibility review.
- Do not delete data without approval; rename instead.

## Definition of done
1. Show the plan first and implement only approved scope.
2. All pass: `npm run format:check`, `npm run lint`, `npm run typecheck`,
   `npm run test`, `npm run build`, `npm run test:e2e`, `npm audit`.
3. New behavior has unit, PostgreSQL and browser tests, including denial cases.
4. Review security, isolation, secrets, mobile layout, keyboard access and safe errors.
5. Update README and add `docs/milestone-N-verification.md` with exact commands,
   results, failures fixed and unverified limits. Never claim unrun results.
6. Stop at the milestone boundary and wait for approval.
