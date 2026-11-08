# PR 6 cloud review correction

## RESULT

Implemented the owned portion of all six findings from the independent review of `d61bc552b81d1a0969fb8a2c3bef73ac1a2a85a0`. The correction branch started at that exact head. Its PR targets `t3/cloud-transactions-nemotron-checkins`, not main. Parent owns independent review, integration, trusted inbox UI and deployment.

1. `read_project_state` includes the authorized snapshot's canonical `checkIns`. Unknown question-card IDs still fail the existing domain/snapshot validation. A fresh-project regression reads the canonical question without any generated card and answers it by the server's ID. Parent's inbox UI remains a separate change; no UI or invented client IDs were added here.
2. Claim transactions take one PostgreSQL transaction advisory lock and check the durable running-lease reservation before admission. No second job is admitted while that global slot has an unexpired lease, including within the same project, different projects or different owners. Completion/cancellation releases it; expiry allows a new generation and old completion is fenced. Independent pools verify distinct PostgreSQL backend PIDs and lease recovery.
3. Scheduler and snapshot construction share policy reconciliation. Already available/presented questions become `scheduled` when quiet hours, pause or account policy defers them. The transition persists a question revision and invalidation before the snapshot is returned. Logical/presentation IDs survive and a later eligible tick can recover the same identity without another attention charge. Display acknowledgment remains after-display accounting, never permission to show a stale snapshot.
4. Probe requests use genuine `tool_choice: auto`. A scoped tool result supplies a goal nonce generated only after the automatic selection; a valid shared proposal must interpret that result and pass domain/job/grant fences. A forced-only endpoint, ignored tool result or wrong epoch cannot enable availability. Requests carry the shared JSON schema as instructions and validate exact RAW JSON; no grammar backend is assumed, and no fences/prose are stripped. One additional model correction is permitted within the four-call limit. The job's correction claim is durable across network retries; the last remaining call cannot create an extra repair request. HTTP auth/schema errors, 202 and unsupported wire responses remain blockers. HTTPS, bearer authentication, exact configured model and finite account budgets remain required.
5. A healthy report can restore stale/blocked to following only inside the unchanged current grant, with available capability and no error. Paused/revoked/export-off permissions cannot be reopened by health. Recovery does not request inference.
6. New defaults are three unsolicited questions per rolling 24 hours, quiet hours 21:00-09:00 in the confirmed IANA zone, and persisted 60-minute account spacing. Eligibility/admission run under the owner lock across projects/processes. Demo timing changes only due time and bypasses none of these constraints. The migration repairs the previous exact default tuple while preserving customized preferences.

## CHANGED FILES

Authored changes only: `apps/cloud/src/{checkins,db,domain,jobs}`, `apps/cloud/src/main.ts`, `packages/nemotron/src/{adapter,runner,tools}.ts`, cloud regression tests and this owned report. No root manifests/dependencies, shared contracts/client, UI, desktop or deployment configuration was edited. The explicitly authorized main merge consumes the parent's pairing changes unchanged.

Schema changes: corrected owner defaults and legacy default tuple; internal `jobs.repair_attempted boolean NOT NULL DEFAULT false`. The durable global slot uses existing job state/lease columns, serialized by transaction advisory lock 7317503. No extra service/table or dependency is needed.

`apps/cloud/lane-a-handoff.md` is the original baseline handoff; this report supersedes its old reminder/probe descriptions.

## CONTRACT IMPACT

No shared DTO/API/signature changes. Snapshot/reference validation is unchanged. The additional `checkIns` read-tool result is canonical server data. Policy withdrawal uses existing check-in states and revisions. No new server-generated question cards or frontend behavior were introduced.

The strict final-result schema travels as a system instruction rather than an assumed provider grammar option. Supported native fields remain exact model, messages, four read tools, automatic choice, `parallel_tool_calls: false`, `stream: false`, `max_tokens: 4096`. Invalid raw output raises a sanitized validation failure; at most one further model call can correct it. No alternate provider, parser/grammar backend setting, output cleanup or guessed endpoint was added.

## TEST COMMANDS AND OUTPUTS

Red evidence before implementation:

- `tests/cloud/leases.test.ts`: three new cases failed because a second job acquired a live lease. Extended coverage also includes a separate synthetic owner.
- `tests/cloud/review-policy.test.ts`: six failed cases demonstrated missing canonical question data, three stale-availability paths, wrong defaults and four simultaneous account admissions.
- `tests/cloud/review-health.test.ts`: stale/blocked failed recovery and an off grant incorrectly accepted a following report (three failures); paused/revoked denial remained passing.
- `tests/cloud/review-probe.test.ts` plus model-safety additions: eight failures demonstrated forced-only probe success, ignored result/wrong epoch acceptance, missing raw model correction and incorrect remaining-budget/retry behavior.

Green commands, using only the authorized dedicated local database URL from the existing gitignored environment file:

```text
node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/vitest/vitest.mjs run tests/cloud --maxWorkers=1 --no-file-parallelism
16 test files / 62 tests passed, 0 failures (62.16 seconds).

node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/tsx/dist/cli.mjs apps/cloud/src/db/migrate.ts
Cloud schema v1 migrated. exit 0; repeated migration/default preservation is also tested.

node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
Before consuming updated main: 36 files / 158 tests passed, 0 failures (78.57 seconds).

pnpm typecheck
tsc --noEmit: exit 0.

git diff --check
exit 0.
```

The latest main integration/final verification result is recorded in the delivery update below. Baseline contract/UI tests were preserved. DST assertions now use the frozen 09:00 quiet-hour end, with the corresponding real spring/fall UTC offsets. The native tool-result continuation assertions still verify each original message plus the explicit raw-schema instruction.

## LIVE EVIDENCE

Actual PostgreSQL: two independent database connections reserve the single global execution slot; old lease generations cannot commit after expiry/reclaim; cancellation releases it. Concurrent independent schedulers/projects persist and enforce account spacing/caps. Snapshots withdraw suppressed availability before a presentation acknowledgment. Health recovery permits ingestion only under the current existing grant. Durable correction allowance survives a synthetic network retry.

The cloud suite also executes the existing production bundle/restart, authenticated HTTP/SSE, source revocation/retention, draft/owner protection and receipts tests. Provider protocol/probe tests inject explicitly synthetic responses; they establish implementation behavior, not live Nemotron capability. No real model request, source export, deployment or GPU/resource action was performed.

## BLOCKERS / REMAINING GATES

- Live model remains unavailable. Parent reports V0 native automatic-tool success, fenced JSON failure, V1 hybrid-layout failure and no qualified FlashInfer cu118/torch2.7 binary. Brev is stopped; no approved endpoint/private credentials/full authenticated raw-schema receipt exist. Fixtures do not clear that gate.
- Parent's trusted inbox change and newest main integration are separate ownership. This lane does not edit or claim independent native/visual verification of those surfaces.
- Railway deployment/configuration remains parent-owned and model OFF. Apply the explicit SQL migration before starting the corrected cloud head; this lane does not touch deployment/root configs or services.
- Native presentation must consume current authorized snapshots and preserve the existing local presentation journal. A cached snapshot or display acknowledgment is not renewed proactive authorization. No exactly-once human perception or hosted timing is claimed.

## COMMIT

Base: `d61bc552b81d1a0969fb8a2c3bef73ac1a2a85a0`. Focused correction commit, authorized main integration, final tested head and stacked PR are recorded in the delivery update/final reply. No force push, PR merge, watch or child agent is part of this task.

## DELIVERY UPDATE / DATABASE RESILIENCE

- Focused review correction: `000aba6`; normal integration merge: `77a5b60c85c5addda38ce1f4b912e941a7ef7df4`, consuming main `5ae1bdc60eda41526de4839e5abef6b98181aa7e` (verified main tree `8089018c3e7d55f0e59cc1fbc6076877473eb3ee`). No conflicts or force push. All pairing files are parent's unmodified main content.
- Main-integrated full suite before the subsequently reported resilience blocker: **37 files / 198 tests passed**, 0 failures (113.50 seconds). TypeScript passes. Web/cloud production bundles build; root build still stops at the desktop entry point absent from this retained checkout.
- Newly reported hosted blocker independently reproduced on this corrected code: after successful readiness, actual app-owned idle PostgreSQL connection termination exited the bundled cloud with code 1. The isolated connectivity-outage fixture also reproduced exit 1. Raw child stderr was held only in test memory and never printed or written to an artifact.
- Cause verified in the installed pg-pool source: its idle listener attaches the client to the error and emits the pool's `error` event. Main had no listener, so Node treated it as unhandled and could print client internals. Main now registers a listener immediately after pool creation and emits only `Cloud database connection unavailable.`. No catch-all exception suppression was added; readiness still performs a real `SELECT 1`; existing SIGTERM/SIGINT shutdown wiring is unchanged.
- `tests/cloud/resilience.test.ts` contains two actual production-esbuild/bundled-main red -> green regressions. One terminates only an idle backend selected by this app's unique synthetic application_name, current database and user. The other uses an isolated, test-owned loopback TCP fixture: only this cloud's database connectivity is removed/restored. No PostgreSQL container/service/database was stopped, replaced, reset or created, and no other backend was terminated. The dedicated playbooks_test URL guard is unchanged and also repeated by the fixture.
- Sanitized local outage receipt: initial readiness **200**; process survives both failures; liveness **200**; disconnected readiness **503** with only the fixed API error; unauthenticated project route **401** while disconnected and after recovery; restored connectivity yields actual readiness **200** without app restart; model capability remains **BLOCKED**. Both focused tests pass. Every emitted stderr line must equal the fixed diagnostic; assertions never expose raw failure output, connection configuration or secrets.
- This is actual PostgreSQL plus an isolated application-connectivity outage, not a claim that Railway's PostgreSQL was stopped/recovered. Hosted acceptance remains **BLOCKED** until its owner repeats acceptance against the final exact corrected head. Railway/root deployment configuration remains untouched and model OFF.
- Resilience fix commit: `184fc59e330410f6eb353f261b9f912255305595` (two bundled-path tests plus TypeScript passed before commit).
- Final main-integrated whole-suite rerun, including resilience: **38 files / 200 tests passed**, 0 failures (88.40 seconds). This tests the six review corrections, actual dedicated PostgreSQL behavior, strict scripted adapter behavior, bundled cloud resilience/restart, contracts and main's UI/pairing tests. `git diff --check` passes. The final delivery head adds only this result record to that tested code.
