# Milestone 3 implementation plan

Approved scope: procedures, immutable versions, agent skills and structured
contracts, draft-only runs/history/step status, usage tracking and safe failures.
Preserve Milestones 1–2. No approval inbox, executor, external model/provider,
integration, deployment, paid service or external side effect.

## Decisions and implementation

1. Add procedure/version/source-reference and immutable skill tables. Owners and
   admins publish versions and create/enable/disable skills; members can run
   visible enabled skills. A skill pins a procedure version, supported operation,
   strict input/output contracts, timeout and token/cost budgets.
2. Add private-to-initiator agent runs and ordered steps with transaction-safe
   transitions, idempotency keys, deadlines, quotas and append-only audit events.
   RLS checks workspace membership and current access to every referenced source
   on procedures, versions, skills, runs and steps. Revocation hides derived output.
3. Execute four deterministic stages: resolve sources, draft, validate, policy gate.
   Load only authorized latest-ready source excerpts. Missing/archived/unprocessed
   sources fail closed. No arbitrary code, dynamic tools, model-controlled roles,
   URLs, approval flags or budgets.
4. Use a real local excerpt-drafting engine by default, explicitly not LLM inference.
   No provider credentials or network calls. A typed adapter boundary allows
   malformed-output/timeout/usage tests without paid or production services.
   Contracts are a small fixed v1 schema, not arbitrary user-executable JSON Schema.
5. Validate bounded JSON, citations and usage independently of instructions.
   Proposed message/record changes are stored with server-derived approval-required
   and execution-disabled flags. No approve/execute endpoint exists in Milestone 3.
6. Record provider/model, usage provenance, input/output tokens and integer micro-USD
   cost. Local runs consume no model tokens and cost zero; unknown usage stays null.
   Test adapters use explicit synthetic pricing, never presented as real pricing.
   No automatic retries. A failed run is immutable; retry creates a new run.
7. Separate create-run and process-run requests. Concurrent/replayed processing is
   rejected; a deadline sweep on history reads marks interrupted runs timed out.
   No background queue. A bounded AbortSignal cancels cooperative adapters;
   late results never mutate terminal records.
8. Add procedure/skill management and run/history/detail UI with empty, loading,
   pending, draft, blocked-proposal, timeout and failure states.

## Verification

Unit: strict contracts, malformed/oversized model output, forged citations,
authority fields, invalid/unknown usage, budget arithmetic, timeout/abort handling.
PostgreSQL: tenant and source ACL isolation, immutable versions and skills,
role restrictions, private run histories, duplicate processing, idempotency,
missing sources, revoked access, safe failures, persisted usage and deadlines.
Browser: publish → bind skill → run → inspect draft/citations/steps/usage,
version pinning, source failure, member restrictions, mobile and Axe checks.
Run formatting, lint, types, all tests, production build, migrations and audit.

## Boundaries and risks

The local engine assembles instructions, inputs and exact reference excerpts;
it does not claim semantic reasoning or completed actions. Provider integration
needs separate approval, real pricing/tokenizer metadata, cancellation semantics,
provider-side budgets and privacy review. Existing public-release gates remain.
Run inputs/results are private application data: no content in audit/error logs.
History is bounded to the latest 100 visible runs; workspace quota is 1000 runs.
No retention deletion, approval workflow or Milestone 4 work.

Official references consulted: https://zod.dev/api,
https://www.postgresql.org/docs/current/ddl-rowsecurity.html,
https://nodejs.org/api/globals.html#class-abortcontroller.
