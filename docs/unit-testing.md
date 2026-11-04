# Unit testing

Run `npm run test:unit` (fast, no database) or `npm run test:coverage` for a
coverage report (text in the terminal, HTML in ignored `coverage/`).
`npm run test` also runs the PostgreSQL integration tests.

Status on 2026-10-23: 418 unit tests in 21 files pass. Unit line coverage is
90.1% overall (statements 89.1%, branches 82.4%, functions 88.6%):

| Area                       | Files | Lines  |
| -------------------------- | ----- | ------ |
| Library and services       | 20    | 99.4%  |
| API route handlers         | 23    | 100.0% |
| Components                 | 11    | 96.2%  |
| Parser worker              | 1     | 95.1%  |
| Security-header proxy      | 1     | 100.0% |
| Pages and layouts (server) | 22    | 0%     |

Pages and layouts are async server components; they are exercised by the
browser tests (`npm run test:e2e`), not unit tests.

## Suites

- `services-*.test.ts`: workspaces, knowledge, agents, approvals with a scripted
  fake database (`support/fake-db.ts`). Unmatched SQL fails the test. Covers
  permission checks before SQL, token hashing, run outcomes, the approval
  gate's defense-in-depth rollback, outcome and error mapping, viewer flags.
- `http.test.ts`, `auth.test.ts`, `env.test.ts`, `db.test.ts`, `edge.test.ts`,
  `routes.test.ts`: request guards, body and upload limits, error mapping, API
  client, auth configuration and route wrapper, local-only config guard,
  transactions, CSP/headers, page-session redirects, and every route handler
  (wiring, id validation, smuggled-field rejection).
- `parser.test.ts`, `knowledge.test.ts`: chunking, DOCX/PDF extraction and
  attacks, scanner and processing outcomes.
- `contracts.test.ts`, `policy.test.ts`, `agents.test.ts`, `approvals.test.ts`,
  `hardening.test.ts`: schemas, permission matrix, budgets, deadlines, text
  rules, logging.
- `components-*.test.tsx` (jsdom, Testing Library): every component's states,
  roles and requests (`support/fake-fetch.ts`).

jsdom note: a file set on an input by Testing Library does not satisfy jsdom's
`required` check or its `FormData`; the upload tests submit the form directly
and supply the chosen file. Real browsers are covered by the e2e upload tests.

## Mutation checks

These behaviors were broken on purpose and each was caught, then restored:
idempotency-key reuse on approval retry, approve-requires-confirmation, Fetch
Metadata rejection, the approval gate's role check, invitation-token hashing,
transaction rollback, and Indic search terms (also end-to-end in
`tests/integration/multilingual.test.ts`).

## Bugs found and fixed while writing these tests

1. Hindi and other Indic-script search terms were discarded (`searchTerms`
   ignored combining marks), so Indic words could never match. Fixed; verified
   end-to-end with Hindi and Tamil documents.
2. A NUL character in any JSON text field failed inside PostgreSQL as a 503.
   Now rejected at the request boundary (400); database encoding errors
   (22021/22P05) also map to 400.
3. The auth route returned 503 (and logged a server error) for a non-object
   JSON body; it now returns 400 like other routes.
4. The browser API client showed raw parser errors ("Unexpected token '<'")
   when a proxy returned HTML, and "[object Object]" for non-string messages.
