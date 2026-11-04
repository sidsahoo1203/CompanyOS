# Milestone 4 implementation plan

Scope: approval inbox, approval request details, approve/reject, edit before
approval, idempotency and replay protection, audit events, permission
enforcement, security hardening, and tests proving rejected or unauthorized
actions cannot execute. Preserve Milestones 1–3. No production integration,
model provider, outbound email, deployment, paid service or external effect.

## Decisions

1. Execution target is a local outbox. Approving a request atomically records
   the exact approved snapshot as an `action_execution` row with executor
   `local-outbox-v1`. Nothing leaves the computer. Milestone 5 replaces the
   executor with real adapters behind the same gate.
2. A run initiator submits a blocked proposal for approval. The request
   snapshots kind, target, content, run inputs and cited sources, and derives
   the expected effect on the server. A SHA-256 digest covers all of these.
   Creation is idempotent per run proposal.
3. Visibility: owners/admins see every request whose sources they can read;
   requesters see their own. Revoked source access hides the request and blocks
   decisions. Foreign tenants see nothing (RLS plus definer checks).
4. Decisions: only owners/admins approve or reject. Nobody approves content they
   authored except the workspace owner (single-person agencies). Every decision
   must echo the digest it reviewed; stale digests are refused. Approval also
   requires an explicit review confirmation, a valid recipient email, no hidden
   or bidirectional control characters, an enabled skill and an unexpired request.
5. Edit before approval: requesters and approvers edit target and content. An
   edit never changes an existing row; it creates the next immutable revision
   (new digest, new 48-hour expiry, new author) and supersedes the previous one.
   Old revisions can never be approved.
6. Replay and idempotency: a decision carries a client idempotency key. The same
   approver repeating the same key gets the original execution; any other key or
   any decision on a closed request is refused. One execution per request is a
   database constraint; concurrent approvals produce exactly one execution.
7. Audit: requested, edited, approved, rejected, expired, executed and denied
   events with reasons. Metadata holds identifiers and reasons only, never
   targets or content. Denied attempts persist (decision functions return an
   outcome instead of rolling back). Decision attempts are limited to 30 per
   person per minute.
8. Hardening: Fetch Metadata check rejecting cross-site API writes, additional
   cross-origin isolation headers, strict Zod schemas, server-side and SQL-side
   permission checks, no direct table writes for the runtime role, and content
   rendered as inert text only.
9. UI: Approvals navigation, an inbox (waiting/history), a detail page showing
   exact target, content, inputs, sources, expected effect and fingerprint,
   revision history, local-outbox evidence and the audit trail (approvers), plus
   a Request approval control on run proposals.

## Verification

Unit: decision/edit schemas, unsafe characters, target validation, permission
matrix. PostgreSQL: request creation and idempotency, visibility, member/self/
foreign denials, reject-then-approve, stale digests, edits and superseded
revisions, expiry, replays, concurrent approvals, disabled skills, revoked
sources, invalid/unsafe content, direct-write denial, audit minimization and
rate limits; every refusal asserts zero executions. Browser: request, review,
edit, approve with local-outbox evidence, reject, member denial, replay and
cross-site refusal, Axe and mobile layouts. Run formatting, lint, types, all
tests, production build, migrations and audit. Stop after Milestone 4.
