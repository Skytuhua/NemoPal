# T03 / J2 model gate - 2026-11-07

Live acceptance: **BLOCKED / HOSTED ATTEMPTS DENIED**. The entry point and response correction were reviewed before Lead attempted the hosted probe. Two HTTP submissions were consumed without qualifying native tool or proposal behavior; the diagnostic attempt returned HTTP 403. No full-app J2 acceptance is claimed.

Operator reports both the Brev VM and hosted NVIDIA API ready. Lead reused the previously supplied private key; NVIDIA's model metadata endpoint returned 200, while the hosted inference diagnostic returned 403. Lead requested a key with inference access privately. The implementation worker received no credential and made no real requests. No VM operation has been performed for this hosted attempt.

## Entry point and guards

The existing `pnpm test:live:model` dispatcher invokes `tests/live/model.ts`. Direct invocation of that file enforces the same live-test opt-in plus the production model opt-in. Importing it has no execution side effect.

| Required environment variable | Guard |
| --- | --- |
| `LP_LIVE_TEST_OPT_IN` | Exactly `1` |
| `LP_MODEL_LIVE_OPT_IN` | Exactly `true`, matching production model configuration |
| `NEMOTRON_BASE_URL` | Explicit HTTPS base URL; production adapter rejects URL credentials, query and fragment |
| `NEMOTRON_MODEL` | Explicit nonempty model identity; no alias/provider substitution |
| `NVIDIA_API_KEY` | Explicit nonempty auth key for that model API; the name does not imply that an NGC credential authenticates it |
| `LP_MODEL_CALL_BUDGET` | Explicit positive safe integer; capped at shared `LIMITS.modelCalls` (4) |
| `LP_MODEL_TOKEN_BUDGET` | Explicit positive safe integer; no spend-enabling default |

Neither opt-in is inferred from supplied credentials. Configuration/constructor errors, exhausted allowance, HTTP/network failures and unsuccessful probes fail closed with exit 2 and safe JSON. Exit 0 requires an authorized real successful production capability probe. Injected fetch always stays `execution: synthetic`, `status: BLOCKED`, exit 2, even when `probePassed: true`. `fullAppVerified` remains false on every receipt.

The entry calls the existing `HttpNemotronAdapter.probe` once with the shared 120-second deadline. The adapter handles Bearer authentication, `tool_choice: auto`, the actual scoped read-tool result with a fresh nonce-bearing goal, strict full `ManagerProposalSchema` validation and proposal authority/fence checks. It owns the single model correction allowance and bounded submissions. The current successful path uses two HTTP calls, or three with one correction, under the four-call ceiling. The entry adds no provider, grammar, parser, framework, response rewriting or client JSON repair.

Receipts contain only fixed status/blocker labels, capability/authority booleans, limits/reservation counts, and endpoint/model SHA-256 values. They omit the key (including a key hash), endpoint/model plaintext, HTTP bodies, exception messages, proposal text, source data and nonce. `proposalAuthorityValidated` reflects production `validateProposal` success inside this synthetic probe context; it does not prove full-app commit/concurrency authority. Reservation counts come from the production adapter before HTTP submission, using its conservative serialized-body byte count plus output reservation; they are not measured provider tokens or dollar cost. The allowance is per invocation, with no database/account ledger; Lead must enforce the authorized single run and any account-wide allowance separately. Repeated invocations allocate fresh per-run allowances.

## Qualification and readiness

Earlier V0 evidence was only partial automatic tool selection; fenced JSON failed. Proven `vLLM 0.10.1.1+cu118` V0 has **no guided grammar enforcement**. Strict raw schema validation plus at most one bounded model correction is the accepted master 8.1 / 6.3 route; neither that acceptance nor old evidence verifies the actual full app/probe. Hosted access will be tried first by Lead after review.

The existing production request reserves `max_tokens: 4096`. The selected deployment must fit the entire schema/prompt/tool context **plus** that output allowance; the old 2048-context smoke-test configuration cannot meet it. Token allowance must cover the adapter's conservative reservation for each submitted call. No readiness default or budget is supplied by this change. V1's hybrid KV layout is incompatible with the available backend; no package, driver, JIT or VM changes are authorized or performed here.

## Executed verification

Prepared isolated branch: `t3/live-model-gate-tests`, base `feat/golden-workflow-integration` (PR 15), joined commit `cb888ef78f9a0aaed9ddd8f016731cb4880ae063`.

- `pnpm install --offline --frozen-lockfile --ignore-scripts`: PASS, all 176 pinned packages reused locally; no download, lifecycle script, dependency or lockfile change. The first attempted test command had reported missing Vitest before installation; that was setup failure, not RED evidence.
- RED: `pnpm exec vitest run tests/cloud/live-model-gate.test.ts --maxWorkers=1 --no-file-parallelism --reporter=dot`: exit 1, 40 assertions failed because the dispatched entry point was absent.
- GREEN: same exact command: exit 0, 40/40 owned deterministic tests passed. These use injected synthetic fetch through the real production adapter. Direct child-process checks supply an isolated synthetic environment and an invalid HTTP endpoint as a second no-network fence; neither operator opt-in can be bypassed.
- `pnpm typecheck`: final PASS (exit 0). The initial run found two owned TypeScript errors (literal-limit inference and a numeric test fixture field spread into `ProcessEnv`); both were corrected locally.
- `pnpm build`: PASS (exit 0); web/cloud/desktop artifacts built without launching any service or native app.

The tests cover guard rejection without HTTP, authentication/AUTO settings, actual tool-result interpretation, safe hashes/redaction, rejection of fences/extra or missing fields/incorrect epoch/owner authority/ignored tool results, one model correction, finite call/token allowances, and sanitized network/HTTP failures. Author self-review traced the entry guards, production probe, reservation accounting, redaction and synthetic/live labeling; parent independent review remains pending. No full DB suite, database, native app, cloud service, Railway action, live observer, real model request or `pnpm test:live:model` against the real environment was run. No children were started. Only the three assigned files changed.

## Lead handoff

After independent parent review, Lead may privately supply the seven required environment values for the hosted endpoint and execute **once**: `pnpm test:live:model`. This command was not run by the implementation agent. Keep credentials outside committed evidence and command output. Retain the safe receipt and actual exit status; an unavailable endpoint, invalid proposal or exhausted budget remains BLOCKED, with no automatic switch to the VM/provider or retry beyond the adapter's correction policy. Full-app J2 acceptance still needs its own authorized integrated evidence.

Publish this focused PR onto PR 15, preserving stack PR 15 -> PR 8 -> PR 5. No watch, merge or self-archive. Parent owns final-result acknowledgment, `completed` / `result_available` / no-pending-child confirmation and recoverable archive after handoff.

## Parent qualification corrections

Independent PR19 review found that inherited response translation discarded native message role/tool type/finish reason and returned model identity. Before correction, 11 new malformed-envelope/model mismatch cases incorrectly qualified (RED). The production adapter now requires assistant messages, native function tool calls with tool_calls termination, final stop termination, and an exact served-model match on every response. Missing or unexplained alias/model differences fail closed; no automatic model normalization is added. Existing positive synthetic envelopes now include those actual protocol fields.

Focused adapter/gate/dispatcher verification: 61 tests passed across 4 files; typecheck and diff checks passed. This is deterministic evidence only. On a successful live probe, the existing model hash now identifies a configuration whose served identity matched on every response; on a failed probe it remains only a requested-configuration hash. No live inference call has been made by this correction. Fresh parent review is pending before the single hosted test.

Broader parent verification after restoring the two model-safety fixture envelopes: full dedicated PostgreSQL/desktop/UI/contracts suite 315/315 across64files PASS, typecheck PASS, production cloud/web/desktop build PASS, diff checks PASS. Independent code reviewer approved the production guard correction and requested those fixture updates; their correction/error-class assertions now pass in the full suite. Still zero real inference calls at this checkpoint.

## Lead hosted attempt: denied, not qualified

Reviewed/tested source: 3a5f09dd8789a37ed39355b3882c255432ff99ff. Official HTTPS API base https://integrate.api.nvidia.com/v1; exact configured model ID nvidia/nemotron-nano-3-30b-a3b from its live model list. Older 9B v2 was absent from that list; its separate Brev receipts are not attributed to this hosted model.

Lead used the existing private key without printing or copying it into the repository. The first guarded production probe submitted one request and blocked before native tool selection. A diagnostic retry retained the same model/production gate and captured only HTTP status; it returned 403. The retry used only the remaining three-call / 114279-reservation allowance, not a fresh four-call budget.

Cumulative receipt: 2 HTTP submissions of the declared maximum 4; 33586 conservative reserved units of 131072. Both probes stayed BLOCKED with all native-tool/result/schema/authority capability flags false and fullAppVerified false. No transcript/source data, API key, provider body or model content was retained in public evidence. No model generation success or dollar charge is inferred from HTTP submission counts. No further inference requests may consume the remaining two slots until usable access/configuration is available. Private detailed safe receipts remain with Lead; the key itself remains outside the repository.
