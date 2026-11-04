# Milestone 3 verification

Verified locally on 2026-10-09, Windows 11, Node.js 24.19.0, npm 11.2.0,
PostgreSQL 18.4 (project-local). Scope: procedures, immutable procedure versions,
agent skills, strict input/output contracts, draft-only run history, step status,
token/cost tracking and safe failures. Milestones 1–2 are retained.
No model provider, integration, approval executor, billing, deployment or
external side effect was connected or performed. No Git commits were made.

## Delivered

- Migrations 003–005: procedure, procedure_version, procedure_source,
  agent_skill, agent_run and agent_step tables with composite tenant keys and
  RLS; definer functions for publish, skill create/toggle, run create, claim,
  step advance, finish and deadline expiry; extended audit actions. Migrations
  004–005 hide a newer restricted version's title on the parent procedure.
- Versions are immutable. Skills pin one exact version, an operation
  (`source_brief` or `message_draft`), the fixed v1 Zod input/output contracts
  (stored as JSON Schema), a token ceiling, a micro-USD cost ceiling and a
  timeout. Only owners/admins publish or manage skills; members run enabled
  skills whose sources they can currently read.
- Runs are private to their initiator. Create and process are separate
  requests; request keys make creation idempotent; a lease allows exactly one
  processor; deadlines expire interrupted runs on history reads. Four ordered,
  timestamped steps: Resolve sources, Draft, Validate output, Enforce policy.
- The default engine `local-excerpts-v1` is deterministic excerpt assembly, not
  LLM inference, and makes no network calls. A typed engine adapter boundary
  lets tests inject malformed, slow, forged and paid-usage engines.
- Output is size-bounded, JSON-parsed and validated by a strict schema; extra
  fields such as model-supplied approvals are rejected. Citations must match the
  authorized retrieval set exactly. Proposals receive server-derived
  `approvalRequired: true`, `executionAllowed: false`, `state: "blocked"`; the
  database independently refuses to store anything else. No approve/execute
  endpoint exists (verified: 404).
- Usage provenance: local runs record `not_applicable`, 0/0 tokens and 0 cost.
  Adapters with unknown usage fail as `invalid_usage`; reported usage is priced
  with trusted integer rates rounded up. Budgets are enforced before a paid call
  (preflight bound) and after it.
- Safe failures with user-facing explanations: missing_sources,
  malformed_output, invalid_citations, timeout, budget_exceeded, invalid_usage,
  engine_failed and access_changed. Failed runs are immutable and never retried.
- UI: procedure publishing, skill management, contract viewer, run creation,
  run history and run detail with steps, usage, citations and blocked proposals;
  loading, empty, running, failure and timeout states.

## Changes made in this verification pass

- Formatting: `tests/e2e/agents.spec.ts` failed `format:check`; Prettier fixed it.
- Error messages: procedure/skill/run SQL errors fell through to the shared
  mapper written for Milestones 1–2, so a run-limit, processing conflict or
  idempotency conflict showed knowledge/membership wording. `src/lib/agents.ts`
  now translates P0002/54000/55000/23505 into agent-specific messages while
  keeping the database code. Two integration assertions now check status 409
  and the message for processing conflicts and idempotency conflicts.
- Stale copy: the sidebar badge now reads "Draft-only release"; the dashboard
  setup list gains step 4 (procedures); AGENTS.md purpose and README describe
  Milestone 3.

## Commands and observed results

All commands ran from `outputs/companyos`, using npm.cmd on Windows.

| Command                                     | Observed result                                                   |
| ------------------------------------------- | ----------------------------------------------------------------- |
| npm.cmd run db:local                        | Local PostgreSQL ready on 127.0.0.1:55432                         |
| npm.cmd run db:migrate                      | 001–005 already applied to development; checksums unchanged       |
| npm.cmd run db:migrate -- --test            | 001–005 already applied to companyos_test; checksums unchanged    |
| npm.cmd run format:check                    | First run exit 1 (agents.spec.ts); after `format`, exit 0         |
| npm.cmd run lint                            | Exit 0; no warnings or errors                                     |
| npm.cmd run typecheck                       | Exit 0; route types generated, TypeScript passed                  |
| npm.cmd run test                            | Exit 0; 6 files, 98 tests passed (before and after the fixes)     |
| npm.cmd run build                           | Exit 0; 35 dynamic routes including procedures, skills and runs   |
| npm.cmd exec -- playwright install chromium | Chromium was absent (first e2e run: 4 launch failures); installed |
| npm.cmd run test:e2e                        | Exit 0; 5 Chromium tests passed in 1.1 minutes                    |
| npm.cmd audit / npm.cmd audit --omit=dev    | Exit 0; 0 known vulnerabilities in both                           |

The Playwright-managed server on port 3100 shut down cleanly after the run.

## Coverage

98 unit/integration tests: unit agents 20, unit knowledge 25, unit policy 8,
PostgreSQL agents 18, PostgreSQL knowledge 15, PostgreSQL workspaces 12.
Milestone 3 adds the 20 unit and 18 PostgreSQL agent tests.

Required Milestone 3 cases:

- Malformed model output: non-JSON, oversized, schema-violating and extra
  authority fields fail as `malformed_output`, store no draft, and still record
  valid usage. Forged or duplicate citations fail as `invalid_citations`.
- Missing sources: no ready document or an archived source fails before the
  engine runs; a source archived mid-run fails closed (unit, PostgreSQL, browser).
- Timeout handling: uncooperative and cooperative engines time out with a stable
  failure; abort signals fire; late results cannot overwrite expired terminal
  runs; queued runs past their deadline expire on read.
- Unauthorized access: members cannot publish or create skills at the service or
  SQL layer; direct version/skill updates are denied; foreign tenants cannot
  read or forge identifiers; run history is hidden even from workspace admins;
  revoking source access hides derived runs and fails in-flight runs closed;
  disabled skills reject new runs and processing; concurrent processing allows
  one claim; idempotency rejects changed payloads.
- Budgets/usage: unknown usage stays unknown and fails; token and cost
  ceilings apply independently; a zero-cost ceiling prevents a paid call.
- Audit events for runs contain no inputs or drafts.

Browser (Chromium): publish v1 and v2, pin a skill to v1, run and process a
message draft, confirm v2 text is absent, blocked proposal and zero usage shown,
`/execute` returns 404, `approved: true` in a run request returns 400, member
permissions and private history, source revocation hides a member's run,
archived-source failure state, Axe scans with zero violations, no horizontal
overflow at 390px and 320px, and no page errors. Screenshots of synthetic data
in docs/screenshots/agent-run.png and agent-run-mobile.png were inspected.

## Limits and unverified items

- The local engine assembles excerpts; it performs no reasoning. A real model
  adapter needs separate approval, real pricing/tokenizer data, provider-side
  cancellation and a privacy review.
- No approval inbox or executor (Milestone 4); proposals are blocked only.
- No background queue: processing is user-triggered; interrupted runs expire.
- No retention deletion; run history is bounded to the latest 100 visible runs.
- Not verified: Firefox/WebKit, physical mobile devices, load testing,
  penetration testing, backup restoration. Earlier README release gates
  (email verification, recovery, antivirus, worker OS isolation, hosting) remain.
- Non-failing warnings: Next.js ignored an unrelated package-lock.json in the
  user's home directory; Playwright printed a NO_COLOR/FORCE_COLOR warning.

Stopped after Milestone 3.
