# Lane A implementation ledger and handoff

Frozen base: `73175daa1f3d55595fcfeb7fe6beab5db337b7c3`. Ownership: cloud source, Nemotron source, cloud tests, this report only.

## Execution ledger

- T02 red: unauthenticated project list returned 404 instead of 401; six database/API regressions failed on absent routes. Dedicated PostgreSQL schema migration and local transactional pairing were exercised.
- T02 green: six tests pass against PostgreSQL at the authorized loopback port. Parallel pairing/replay, restart reconstruction, owner/device fences, duplicate uploads, revoke/pause, draft CAS and delete tombstones covered.
- Ruling: revocation always removes retained observation content and derived content, even when `removeExcerpts` is false. Retaining less content preserves the permission boundary. Old content-bearing receipts become non-content tombstones and return 409 on replay.
- Ruling: source health cannot resume a paused grant. Only the explicit state command can do that. Health/presentation/SSE never enqueue inference.
- Ruling: owner reminder consent/timezone are operator-provisioned settings. Missing consent disables proactive questions. The frozen API has no preference mutation DTO.
- Parent owns independent review; no nested agents or reviewer were started.
- T02 committed as `f9c78de` after migration, six cloud regressions and TypeScript passed.
- T03 red: scripted read-tool/continuation and budget regressions failed with runner unavailable; adapter protocol/error regressions failed with adapter unavailable; four queue regressions failed because no job could be claimed.
- T03 green: 6 cloud files / 20 tests pass against local PostgreSQL, and TypeScript passes. Deterministic fetch responses exercise the provider protocol without any external inference.
- Ruling: this adapter supports explicit HTTPS chat-completions routes with non-streamed JSON. It sends `stream:false`; unsolicited SSE and 202/pending responses are unsupported blockers. Exact selected endpoint compatibility remains a live gate, never assumed from NVIDIA documentation.
- Ruling: setup additionally requires `LP_MODEL_LIVE_OPT_IN=true` and positive finite `LP_MODEL_TOKEN_BUDGET`. Durable conservative byte-plus-output token reservations include failed/unknown calls and capability probes. Budget exhaustion never rotates provider or resets counters on restart.
- Ruling: model-created done/skipped states and user-reported labels are rejected. Owner actions/answers establish those states; genuine read metadata retains its source evidence label.

## RESULT

In progress: T02 persistence/API; T03 and T08 follow as sequential deliverables.

## CHANGED FILES

See focused commits; all changes remain inside Lane A ownership.

## CONTRACT IMPACT

No shared schema/client changes. Request hashes use the exact pathname and parsed envelope.

## TEST COMMANDS AND OUTPUTS

`node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/vitest/vitest.mjs run tests/cloud --maxWorkers=1 --no-file-parallelism` — T02: 2 files / 6 tests passed.

## LIVE EVIDENCE

Actual dedicated local PostgreSQL transactions. All source records are synthetic and labeled fixture. Model/cloud hosting live gates BLOCKED. NVIDIA Brev compute credit does not configure or authorize model calls or resource creation.

## BLOCKERS

Exact authorized Nemotron HTTPS endpoint/model, private API credential, positive finite call/token allowance, successful capability probe, and cloud host are unavailable. No alternate provider, purchases, deployments, resource creation or real inference calls.

## COMMIT

Sequential deliverable commit hashes will be recorded at final handoff.
