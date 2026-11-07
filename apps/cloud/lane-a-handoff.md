# Lane A handoff: T02 / T03 / T08

## RESULT

Implemented the local, owner-authorized cloud baseline: actual PostgreSQL transactions, hashed pairing/access credentials, receipt replay/CAS, the complete shared HTTP client endpoint table, authenticated SSE, bounded Nemotron adapter/read tools, durable leased jobs, source withdrawal/retention, and persisted questions and owner answers.

Frozen base: `73175daa1f3d55595fcfeb7fe6beab5db337b7c3`. Merged main `0452ee0af9093391d1bec78049b355bf861131b2` without conflicts or force push. PR target: main. Parent owns independent review/integration. No nested agents were started.

Local implementation is delivered. Live Nemotron, application endpoint, hosted operation, native desktop and live source export remain BLOCKED. No model request, GPU launch, purchase, deployment, private-history read or actual source export was performed.

## CHANGED FILES

Only owned surfaces differ from main:

- `apps/cloud/src/api/{server,events}.ts`: complete routing, strict parsing, authorization, sanitized errors, minimal SSE.
- `apps/cloud/src/auth/{credentials,grant}.ts`: 256-bit grants/tokens, hashes in storage, atomic single-use redemption, expiry, repeated bootstrap reuses the owner, independent device revocation.
- `apps/cloud/src/db/{schema.sql,migrate.ts,transaction.ts}`: idempotent SQL migration and transaction helper.
- `apps/cloud/src/domain/{store,errors}.ts`: atomic commands, dependencies, receipts/events/jobs and content withdrawal/tombstones.
- `apps/cloud/src/jobs/{queue,worker,model-settings}.ts`: durable work, 180-second lease, generation fences, 30-second renewal, bounded dispatcher/account reservations and explicit model setup gate.
- `apps/cloud/src/checkins/{policy,scheduler,commands}.ts`: injected-clock policy, 15-second dispatcher, consent, quiet hours, caps, subject CAS, snooze/presentation identity, answer/cancel.
- `apps/cloud/src/main.ts`: cloud executable and shutdown.
- `packages/nemotron/src/{index,adapter,runner,tools,proposal-validation}.ts`: native protocol confined to adapter; four allowlisted reads; bounded loop; proposal/semantic validation.
- `tests/cloud/{api,transactions,adapter,manager,leases,model-safety,checkins,checkin-policy,http-client,operator,process-restart,retention,revocation}.test.ts`, `helpers.ts`, `evidence/j1-samples.json`.
- This report.

No dependencies were added. Root manifests/lockfile, shared contracts/client, UI and desktop ownership were preserved. Their main changes were consumed without local edits.

## CONTRACT IMPACT

No exported DTO/signature changes. Hashes use `hashCommand(exact pathname, parsed envelope)`. Model-created tasks derive revision 0 and ownerOverride false server-side. Owner edits/recorded answers establish owner authority; models cannot create user-reported verification, completion, skipped scope, grants, code execution or draft writes.

| Method | Path | Result |
|---|---|---|
| GET | `/health/live`, `/health/ready` | Minimal process/database readiness |
| POST | `/v1/auth/redeem` | Scoped credential for device bootstrap |
| GET / POST | `/v1/projects` | Project summaries / AcceptedJob |
| GET | `/v1/projects/:id/snapshot` | ProjectSnapshot |
| POST | `/v1/projects/:id/actions` | CommandReceipt<Project> |
| DELETE | `/v1/projects/:id` | CommandReceipt<null> |
| POST | `/v1/projects/:id/messages` | AcceptedJob |
| PUT | `/v1/projects/:id/documents/:documentId` | CommandReceipt<DocumentDraft> |
| POST | `/v1/projects/:id/sources` | CommandReceipt<SourceBinding> |
| POST | `/v1/sources/:id/state`, `/revoke`, `/health` | CommandReceipt<SourceBinding> |
| POST | `/v1/sources/:id/observations` | CommandReceipt<IngestionResult> |
| GET | `/v1/events?after=<seq>` | Authenticated minimal SSE invalidations |
| POST | `/v1/checkins/:id/presented`, `/answer`, `/snooze`, `/cancel` | CommandReceipt<CheckIn> |
| POST | `/v1/jobs/:id/cancel` | CommandReceipt<null> |

J1 actual response IDs/hashes, document/source receipts, fixture observation, snooze receipt and post-revocation snapshot: `tests/cloud/evidence/j1-samples.json`. It contains no bearer/pairing/database/provider secret and explicitly labels synthetic-source/scripted-manager evidence.

Creation request: `{operationId: UUID, input: {title, brief}}`. Accepted result: `{receipt: {operationId, requestHash, status: "accepted", result: null, projectRevision, eventSequence}, jobId, state: "queued"}`. It is a durable queued job, never fabricated completion.

Revisioned commands place expectedRevision in the envelope once: project for actions/messages/enrollment/deletion, document for draft saves (initial 0), question for answer/snooze/cancel. Source commands carry input grantRevision. Snooze is `{until, timezone}`, retains question ID and creates a new presentation UUID. Presentation does not answer or request inference.

Operational settings:

- DATABASE_URL required; migrate explicitly. Tests refuse reset unless host is 127.0.0.1, port 55432, database playbooks_test, user playbooks. No other database/container is touched.
- Bootstrap: confirmed LP_OWNER_TIMEZONE, optional LP_OWNER_ID, LP_REMINDERS_CONSENT=true only with consent. `pnpm owner:grant` emits a one-use ten-minute code to the operator console. Access tokens expire after 48 hours; none are in this report.
- Device revocation: set LP_OWNER_ID, run the grant entry point with `revoke-device <device UUID>`. Confirmation contains no token. Reminder preference changes remain operator/database-owned because v1 has no preference mutation DTO.
- Start: `pnpm dev:cloud` after loading the local DB environment. PORT defaults to 4310; non-loopback PUBLIC_ORIGIN requires HTTPS.
- Live setup additionally requires LP_MODEL_LIVE_OPT_IN=true and positive finite LP_MODEL_TOKEN_BUDGET alongside exact endpoint/model/private key and LP_MODEL_CALL_BUDGET. Parent should document those two additional setting names in root setup; no root edit was made here.
- Base URL must be HTTPS; adapter appends /chat/completions. Requests use stream:false, parallel_tool_calls:false, max_tokens:4096 and the shared JSON-schema response format. Unsolicited streaming and asynchronous 202 are unsupported blockers. Selected vLLM JSON compatibility is unverified.
- LP_DEMO_TIMING=true alone permits the visibly labeled 20-second due floor; otherwise routine suggestions have a five-minute floor. It does not bypass quiet hours or consent.

## TEST COMMANDS AND OUTPUTS

Actual local commands, with no secret printed/copied:

```text
pnpm install --frozen-lockfile
exit 0; no manifest/lockfile change.

node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/tsx/dist/cli.mjs apps/cloud/src/db/migrate.ts
Cloud schema v1 migrated. exit 0; rerun after main integration passed.

node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/vitest/vitest.mjs run tests/cloud --maxWorkers=1 --no-file-parallelism
Pre-integration: 13 files / 38 tests passed.

node --env-file=C:/Users/user/Documents/NemoPlaybook/.env node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
Final main-integrated run: 33 files / 135 tests passed, 0 failures (55.37 seconds).
Includes all cloud regressions, contracts and UI tests; the final duplicate-batch red -> green is included.

pnpm typecheck
tsc --noEmit: exit 0 after main integration and final cloud change.

git diff --check
exit 0.

pnpm build
Web production and cloud bundles passed.
Overall exit 1: apps/desktop/src/main/index.ts is not implemented in this checkout.
Desktop/integration gate; no desktop file was invented or edited.
```

Red -> green ledger:

- T02: unauthorized project list returned 404 instead of 401; concurrent replay/ingestion/deletion routes were absent. Six PostgreSQL regressions passed after implementation.
- T03: runner/adapter regressions failed unavailable; four lease/proposal tests could not claim a job. They passed after implementation.
- T08: five durable lifecycle tests failed checkins_unavailable, then passed. Additional coverage includes one open question, quiet hours, cap, consent, pause/resume, DST and duplicate presentation.
- Omitted model citations initially left source-derived text after revocation. Server-owned dependencies now withdraw task titles, replies, decisions, questions and workspace panels. Owner drafts/corrections/answers survive.
- Seven-day cleanup initially left stored excerpts; it now purges persisted excerpts using server receipt time, invalidates dependencies/leases and retains safe metadata.
- Paused-project cancellation initially returned 409; now cancels without completion. Operator bootstrap initially created a second owner; now reuses the owner and supports independent device revocation.
- Main's stricter receipt acknowledgments exposed repeated IDs within an ingestion batch: initially 200 with duplicate acknowledgments; now atomic 422 with no observation insert.

## LIVE EVIDENCE

Actual dedicated PostgreSQL 17.11: migration, concurrent single-use redemption/replay, row-locked commands, owner/device denial, ingestion/deduplication, revoked/paused upload rejection, draft CAS, deletion tombstones, lease generations, stale owner/proposal races, source/retention withdrawal, account reservations and persisted questions.

Actual loopback HTTP/shared client: all domain endpoint families validate returned schemas, IDs and hashes. SSE contains only invalidation fields and terminates after current credential revocation. Source provenance remains fixture.

Actual cloud source and bundled executable: starts without a model credential; stopped/restarted twice. Snoozed question survives first restart; recorded owner answer survives second, with one question and user-reported task completion. Restart test uses production cloud esbuild options and removes its temporary bundle.

Nemotron protocol tests inject deterministic HTTP responses/scripted adapter. They exercise production adapter/parser/runner code without actual inference. No fixture adapter is selected as a live fallback; unconfigured production inference is unavailable and jobs remain queued.

## BLOCKERS

- MODEL LIVE: coordinator reports GPU/native tool-parser progress, but full V1/native Nemotron JSON gate remains unverified and no approved application endpoint/private credential/finite allowance is supplied. No model calls issued; no substitute model/provider.
- CLOUD LIVE: no application host/HTTPS origin, deployed database, SSE hosting or hosted restart acceptance. Local persistence is not laptop-independent cloud proof.
- INTEGRATION: desktop source absent from this checkout; complete root build is blocked. Native desktop, selected-source observation, export consent and golden three-lane workflow are separate gates. Source export stays OFF outside synthetic local tests.
- ROOT SETUP: document additional opt-in/token-budget settings. CI currently checks contracts/TypeScript, not PostgreSQL; parent should add an explicitly dedicated PostgreSQL CI service at integration. Root/CI files were not edited.

Bounded choices: four model calls, six tools, 120-second deadline; at most one retry; spent/unknown attempts retained in durable account reservations. Unknown dollar cost is unavailable, never zero. Auth/schema/pending-response failures block the job. Conservative dependencies can withdraw more generated content than actually used. One open routine question/project and rolling 24-hour attention cap. No heartbeat/SSE/presentation/accepted model update recursively requests inference.

## COMMIT

- f9c78de: T02 persistence/auth/API.
- bc6c025: T03 bounded adapter/tools/leases.
- d2eab41: T08 persisted check-ins/owner commands.
- e9c0a82: source/retention/restart/operator fixes and owned-scope formatting.
- f7348fea1c1a150aa79d2ad6c376d059d3859540: merge main 0452ee0 without conflicts.
- Final delivery commit/PR reported in the final reply; this report is part of that commit.
