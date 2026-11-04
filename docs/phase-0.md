# CompanyOS: Phase 0

Date: 2026-10-04. Status: approved by the user; implementation restricted to Milestone 1.

## Discovery

No existing Git repository, application files, manifests, scripts, tests, or hosting
configuration existed. Node 24.19.0, npm 11.2.0, and Git 2.43.0 were available.
No Docker or PostgreSQL executable was found on PATH.
AGENTS.md was created and inspected as the only project file before scaffolding.
The supplied budget and experience values are unresolved placeholders.
No customer data, external account connections, or paid infrastructure are assumed.

## Product requirements

Audience: 5–50-person digital agencies; buyer: founder or operations lead.
Core outcome: find authorized knowledge and convert a procedure into a reviewable
action proposal with truthful status and a recorded human decision.
A completed external action must have execution evidence.
Separate sourced facts, inference, suggestions, proposed actions, and completed actions.
Every knowledge answer must cite authorized sources or acknowledge insufficient evidence.

First usable product flow: create workspace → add team → upload source → document
procedure → create skill → draft a run → review proposal.
External integrations are subsequent enhancements. Document uploads and manually
imported conversations must make the product useful before OAuth is introduced.

## Architecture proposal

A modular monolith: Next.js App Router, strict TypeScript, React, PostgreSQL,
Better Auth with its PostgreSQL adapter, Zod input schemas, and parameterized SQL.
Use npm with a committed lockfile. SQL migrations make RLS policies reviewable.
Keep authentication and tenant database pools under separate least-privilege roles.
The migration account is never available to request handlers.
Transaction-local actor context plus row-level security protects tenant reads.
Narrow SQL functions enforce writes; server services independently authorize requests.
Session validation uses the database; no cached role decisions.

Current milestone runs locally, including a real local PostgreSQL server. A managed
Node hosting service and managed PostgreSQL are the eventual deployment shape;
provider and spending are undecided. No cloud provisioning is authorized.
Later add private object storage, background processing, and pgvector only when the
knowledge milestone needs them. AI calls happen on the server behind validated adapters.
Do not use microservices, swarms, autonomous spending, custom training, or native apps.

## Milestone 1 requirements and boundary

- Email/password signup, signin, signout, durable sessions.
- Workspace creation and workspace selection, including multiple workspaces per user.
- Owner, admin, member roles; live permission checks.
- Manually shared expiring invitations, bound to the signed-in email; no email delivery.
- Owner manages admin/member roles; owner role is immutable in this milestone.
- Owner/admin edit workspace settings; members can read their workspace.
- Responsive dashboard, member directory, settings, and truthful setup/empty states.
- Versioned schema/migrations, local synthetic seed, isolation and permissions tests.
- Minimal security event records from day one.
  Not included: documents, AI calls/runs, approvals workflow, integrations, billing,
  workspace deletion/export, public deployment, password reset, or outbound email.
  Account verification/recovery is a mandatory release gate before public onboarding.
  This milestone is a functioning local foundation, not the complete production SaaS.

## Data model

Current:

- user: global identity, unique normalized email, display name, verification status.
- account/session/verification/rateLimit: Better Auth credential/session infrastructure.
- workspace: UUID, name, industry, IANA timezone, language, retention preference,
  creator, created/updated timestamps.
- workspace_membership: workspace/user foreign keys, role, joined timestamp;
  composite workspace/user primary key.
- invitation: workspace, normalized email, admin/member role, token digest (never raw),
  creator, expiry, acceptance timestamp; one pending invitation per workspace/email.
- audit_event: workspace, actor, timestamp, action, target, result, risk, minimal metadata.
  Roles and their permissions are a fixed code/SQL policy matrix, not configurable tables.

Later, using incremental migrations:

- KnowledgeSource → Document → DocumentChunk; tenant keys, ACL, owner, versions,
  archive/processing status; vectors filtered by tenant and permission before ranking.
- Procedure → ProcedureVersion → Skill; explicit contracts and budgets.
- AgentRun → AgentStep/ToolCall → ApprovalRequest; immutable proposal digest,
  expiry, atomic consumption, execution idempotency key; Feedback and UsageRecord.
- Integration → OAuthCredential; encrypted tokens server-only, scopes, revocation.
- Subscription; app-controlled plan entitlements, no autonomous financial operations.
  All workspace children carry workspace_id; cross-child foreign keys include it.
  Deletion/export and retention require dedicated workflows, including credential
  revocation, object/vector cleanup, and documented backup retention.

## Milestone sequence and acceptance

1. Foundation: auth, workspace/membership, roles, dashboard, migrations/seeds.
   Gate: real PostgreSQL isolation/role tests, browser signup/invite flows,
   mobile/desktop checks, format/lint/types/build.
2. Knowledge: bounded uploads, scanning hook, parsing, chunking, retrieval, citations.
   Gate: file/tenant/ACL adversarial tests and reliable no-answer behavior.
3. Procedures and skills: versioned SOPs, schemas, draft-only structured runs/history.
   Gate: schema failures, injection-resistant policy boundaries, limits/timeouts.
4. Approvals: exact target/payload, edit creates new proposal, expiry/replay checks,
   audited decisions, deterministic execution gate and idempotency.
5. Integrations: Drive → Slack → Gmail; least scopes, revocation/deletion and retries.
   Add Linear/Trello only after these work and scope is explicitly prioritized.
6. Usage, monitoring, privacy workflows, deployment preparation.
   Gate: full acceptance suite, restore exercise, release security/accessibility review,
   explicit production approval. No successful metrics without real usage.

## Risks and mitigations

- Tenant leakage: server checks, database RLS, restricted runtime role, direct SQL tests.
- Role escalation/stale permissions: live membership queries, immutable owner,
  database rechecks, negative tests.
- Unverified email impersonation: local-only auth mode; public deployment blocked
  until verification and recovery are designed and tested.
- Invitation theft/replay: high-entropy token, hash storage, email binding, expiry,
  atomic acceptance; URL fragment avoids access-log/referrer leakage.
- Pool context leakage: transaction-local settings and rollback/release tests.
- Secret leakage: ignore env files; safe errors; no bodies/tokens in audit metadata.
- Dependency drift: official docs, exact versions, lockfile, vulnerability review.
- Solo developer scope: stop at each complete milestone; avoid speculative services.
- Cost uncertainty: no paid resources; obtain actual budget before provider selection.
- Future prompt injection: sources are untrusted data, never authority for tool access.
- Accessibility: semantic forms, focus visibility, keyboard operation, automated
  checks and mobile overflow checks; automated scans are not a complete audit.
- Backups, email verification, recovery, TLS/proxy settings, and monitoring remain
  release work; passing a build alone does not establish production readiness.

## Primary references checked

- https://nextjs.org/docs/app/getting-started/installation
- https://nextjs.org/docs/app/guides/self-hosting
- https://better-auth.com/docs/installation
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/adapters/postgresql
- https://better-auth.com/docs/concepts/rate-limit
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://node-postgres.com/features/transactions
- https://github.com/leinelissen/embedded-postgres
