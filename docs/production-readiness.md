# Production readiness

Review date: 2026-10-09. Status: **not production-ready**. Five critical
blockers and three high-priority items remain open; each needs a decision from
the product owner (hosting, budget, email provider, backup target, scanner).

## Fixed and verified (2026-10-09)

| Finding                                                    | Fix                                                                                                                                                                                               | Evidence                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C6 Members could not be removed                            | Migration 008 `app.remove_member`; DELETE `/api/workspaces/:id/members`; Members page remove/leave with confirmation. Pending approvals they requested/wrote expire; invitations they issued end. | 5 PostgreSQL tests (`offboarding.test.ts`), browser test removes a member via UI and confirms 404 on their next request                                            |
| H1 Approver identity spoofable via editable display names  | Migration 009 `app.workspace_people` (includes former actors); approvals, revisions, executions and audit show "Name (email)"                                                                     | Integration test renames a user to the owner's name and the email still identifies them; browser test asserts the label                                            |
| H2 Unexpected failures invisible                           | `src/lib/log.ts`: redacted JSON lines; API/auth 5xx return a matching `reference`; engine and parser failures logged; auth library warnings routed through the logger                             | 5 unit tests: redaction, reference matching, no logging of 4xx, no emails/values in log lines                                                                      |
| H5 Parser packaging (and a real bug found while verifying) | Valid PDFs failed with `invalid_format` in every production build (pdf.js loaded `./pdf.worker.mjs` from disk). The worker module is now provided in-process; tracing root pinned                 | Built worker parses PDF/DOCX/TXT, including from an isolated copy with no `node_modules`; browser test processes a real PDF and DOCX through the production server |
| H6 (part) Local secrets displayed in a session transcript  | Rotated all three database role passwords, `BETTER_AUTH_SECRET` and `SEED_PASSWORD`; seed accounts re-hashed; stale seed sessions removed                                                         | Old credentials rejected, new accepted (roles and seed sign-in)                                                                                                    |
| Accessibility: run page had two live status regions        | Single live region on the run page (also removed a timing-dependent test failure)                                                                                                                 | Browser suite passes                                                                                                                                               |

## Still open

Critical (block any public deployment):

1. No deployment configuration, TLS, health checks or production database
   setup; local-only guards in `src/lib/env.ts` and the migration runner.
2. No email verification or account recovery.
3. Auth rate limits use one shared loopback bucket; needs trusted-proxy client
   IPs and per-account limits for the chosen host.
4. No backups, point-in-time recovery or tested restore; migrations are
   forward-only.
5. No real antivirus; untrusted PDF/DOCX parsing runs in a worker thread inside
   the web server process (not OS-isolated).

High:

1. No account deletion, data export, workspace deletion or retention
   enforcement (DPDP Act / GDPR).
2. No global quotas: unlimited sign-ups × 10 workspaces × 50 MiB and parser CPU.
3. Production secrets need a managed secret store (local rotation is done).

Medium and low items are listed in the review (audit growth, bytea file
storage, zip-bomb limits based on declared sizes, prompt-injection heuristic,
approval notifications, owner transfer, MFA, RLS performance, dependency
updates, CSP inline styles, raw status codes in the UI). Also open: the auth
library's module-level fallback logger still prints its own constant error
messages (for example "Invalid origin") in plain text; private sources created by
a removed member become unreadable to everyone and need an ownership-transfer
decision.

## Verification run (after all fixes, with rotated credentials)

- `npm run format:check`, `npm run lint`, `npm run typecheck`: pass.
- Migrations 001–009 applied to development and test.
- `npm run test`: 10 files, 130 tests passed.
- `npm run build`: pass, no warnings.
- `npm run test:e2e`: 7 Chromium tests passed.
- `npm audit`: 0 vulnerabilities.
