# Milestone 1 verification

Verified on 2026-10-04, Windows, Node.js 24.19.0, npm 11.2.0.
Scope: CompanyOS Milestone 1 only. No deployment or external integration occurred.

## Implemented

Next.js 16.3.8, React 19.3.0, TypeScript 6.0.3, PostgreSQL 18.4 local binaries,
Better Auth 1.7.7, exact dependency versions and npm lockfile.
Email/password signup, signin, signout, durable sessions, multi-workspace
onboarding, workspace creation, owner/admin/member roles, manually shared
expiring invitations, atomic acceptance, role changes and editable settings.
Dashboard, member directory, responsive navigation, accessible forms, empty/error states.
Versioned SQL migrations, restricted auth/tenant roles, RLS, server-side authorization,
safe errors, bounded request bodies, CSRF checks, CSP and other security headers.
Synthetic local seed and isolated test database; minimal workspace/membership security events.

## Documentation-only checkpoint

The directory initially contained no repository/application files. AGENTS.md was
created first, read back, and the project was recursively listed: it was the only file.
No application/configuration changes occurred at that checkpoint.
Initial AGENTS.md SHA256:
FC3E0200A1578207AB289CB624E9B9808C0913F39CBD30B8FAEB5CC473245762

The subsequently authorized Milestone 1 initialized the Git repository and added
application files. AGENTS.md was then refreshed from the actual package scripts
and directories. The final repository is intentionally changed by that implementation.
Files remain uncommitted; no remote repository was created or pushed.

## Actual commands and results

Commands below used Windows npm.cmd; npm is equivalent on other platforms.

| Command                                       | Final result                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm.cmd run db:local`                        | Local PostgreSQL started on 127.0.0.1:55432; random credentials stored in ignored files |
| `npm.cmd run db:migrate`                      | 001_foundation.sql applied; repeat reported already applied                             |
| `npm.cmd run db:migrate -- --test`            | Migration applied to companyos_test                                                     |
| `npm.cmd run db:seed`                         | Four fictional accounts/two workspaces created; repeat succeeded without duplication    |
| `npm.cmd run format`                          | Prettier completed successfully                                                         |
| `npm.cmd run format:check`                    | All matched files conform                                                               |
| `npm.cmd run lint`                            | Exit 0; no errors or warnings                                                           |
| `npm.cmd run typecheck`                       | Route types generated; TypeScript exit 0                                                |
| `npm.cmd run test`                            | 20 passed: 8 unit + 12 PostgreSQL integration tests                                     |
| `npm.cmd run build`                           | Optimized build succeeded; all application routes server-rendered dynamically           |
| `npm.cmd exec -- playwright install chromium` | Chromium test browser installed                                                         |
| `npm.cmd run test:e2e`                        | 3 Chromium tests passed against the final production build (31.3 seconds)               |
| `npm.cmd audit`                               | 0 known vulnerabilities, including development dependencies                             |
| `npm.cmd audit --omit=dev`                    | 0 known production dependency vulnerabilities                                           |
| `npm.cmd run start`                           | Local preview ready on 127.0.0.1:3000                                                   |

The local preview was also fetched with Invoke-WebRequest: HTTP 200, CompanyOS
content/signup link present, X-Frame-Options DENY, private/no-store cache headers.
git check-ignore confirmed .env.local, local database credentials and test artifacts
are ignored. No production credentials were used.

## Tested behavior

- Workspace creation persists a single owner and supports listing authorized workspaces.
- Cross-tenant reads/writes fail at the server; RLS hides rows from direct unfiltered queries.
- Runtime role cannot read auth sessions, bypass RLS, or directly update tenant tables.
- Members cannot edit settings; admins cannot grant roles or invite admins.
- Owner role changes affect the next request; the owner cannot be demoted.
- Invitations are email-bound, expire, reject replay, and allow only one concurrent
  acceptance. Replacement invalidates the previous token.
- Transaction context is removed after commit and rollback.
- Audit metadata excludes secrets and invitation tokens; member access to admin events is denied.
- Real browser signup, workspace creation, invitation acceptance, role update,
  settings persistence, signout, signin and protected-page redirection.
- API authentication, isolation, same-origin enforcement, input/size validation,
  safe errors and security headers.
- Chromium desktop and mobile workflows; no horizontal page overflow in checked
  mobile views at 390px and settings at 320px.
- Keyboard skip link and focusable scrolling member table.
- Axe scans: signup, desktop/mobile dashboard, settings, mobile member directory;
  zero reported violations in those scans.
- Desktop/mobile dashboard screenshots were visually inspected; screenshots are
  under docs/screenshots.

Automated scans do not establish complete WCAG conformance. Safari, Firefox,
physical mobile devices, penetration testing, load testing and backup recovery
were not verified.

## Failures found and resolved

- First type check: Better Auth's generic singleton type was incompatible. Replaced
  it with the inferred factory return type; subsequent type checks/build passed.
- Dependency audit: the Next lint preset pulled a vulnerable braces dependency.
  Replaced that preset with explicit TypeScript, React Hooks and JSX accessibility
  lint rules; final audit is clean.
- Final table accessibility fix triggered no-noninteractive-tabindex. Configured
  the rule's documented role allowance only for the members page so its named
  overflow region is keyboard-focusable; lint and expanded browser suite passed.
- An initial source-write command exceeded Windows command length limits. It did
  not execute; source files were written in smaller batches and then verified.

Nonblocking tool warnings: Next ignored an unrelated ancestor lockfile outside
this Git repository; Playwright printed a FORCE_COLOR/NO_COLOR environment warning.

## Remaining release gates and deferred work

This is a functioning local foundation, not the complete production-ready SaaS.
Local accounts do not verify email ownership. Public hosting is blocked by local-only
configuration until verification/recovery and production security setup are implemented.
No document uploads, knowledge retrieval, AI execution, action approvals, integrations,
billing, export/deletion workflows, automated retention, monitoring or full audit UI.
The retention setting records a preference and does not delete data.
No fabricated agent activity, time-saving measurements or success metrics are shown.
The actual budget and experience level remain unspecified placeholders.
Managed hosting/provider/cost selection still requires the user's decision and
production deployment still requires explicit approval.

Milestone 1 ends here. See phase-0.md for the remaining milestone sequence.
