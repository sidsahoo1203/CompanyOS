# Integration testing

Run `npm run db:local` (keep it running), `npm run db:migrate -- --test`, then
`npm run test:integration`. Tests use only the isolated `companyos_test`
database and create uniquely named fictional records.

Status on 2026-10-23: 88 integration tests in 8 files pass (previously 70 in 6).

| File                   | Focus                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `workspaces.test.ts`   | tenancy, RLS, roles, invitations, transaction context                                          |
| `knowledge.test.ts`    | source ACLs, uploads, versions, citations, leases, audit, rate limits                          |
| `agents.test.ts`       | procedures, pinned skills, runs, failures, timeouts, usage                                     |
| `approvals.test.ts`    | approval gate, revisions, replay, expiry, unsafe content                                       |
| `offboarding.test.ts`  | member removal and identity after removal                                                      |
| `multilingual.test.ts` | Hindi/Tamil search end to end; NUL mapping                                                     |
| `http-stack.test.ts`   | new: real requests through the auth route, Better Auth sessions, `api()`, services, database   |
| `lifecycle.test.ts`    | new: cross-role journey, live role changes, removal, audit volume, expiry, limits, concurrency |

## Test-driven cycle (2026-10-23)

Red: the new tests were written first. Three failed.

1. An admin could revive a removed person's expired approval request by
   editing it, producing a fresh approvable revision. Expected: refused.
2. Every document view wrote an audit row (25 views → 25 rows). Expected: at
   most one per person and document per 10 minutes.
3. A demoted admin received 404 rather than "forbidden". The behavior is
   stricter than the test assumed (they can no longer even see the request);
   the test was corrected, not the code.

Green: migration `010_integration_fixes.sql` refuses edits of requests whose
requester is no longer a member and deduplicates document-access audit events;
`getApproval` reports `canEdit: false` for such requests (unit test added).

Refactor: none needed. Mutation check: removing the session check in `api()`
makes the HTTP-stack tests fail (2 of 9), so they detect auth regressions.

Characterization (passed first time): salted password hashes; tampered and
missing cookies refused; privileged sign-up fields ignored; case-insensitive
duplicate emails refused; identical responses for wrong password and unknown
account; sign-out revokes the session; cross-tenant reads/writes 404;
cross-site, malformed, NUL, oversized and smuggled-field writes refused;
consecutive versions under concurrent uploads; 10-workspace and 50-source
limits; expiry audited once.

Suite interaction: integration sign-ups share the local 10/minute sign-up
limit with the browser tests. The browser sign-up helpers now wait out the
window once instead of failing; the limit itself is unchanged.
