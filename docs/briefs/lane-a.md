# Lane A requirements excerpt

Source: owner-approved living-playbooks-master-plan.md. Frozen contracts and docs/contracts-v1.md resolve implementation DTO details. Only assigned lane ownership is authorized; other lane assignments below are context.

## Global constraints

- Build a new application with a separate name, profile, and data directory. This is not a Maritime project, a company simulator, or a Gen V1 plug-in.
- Keep projects and manager icons on the left, a useful project workspace in the center, and project chat on the right.
- Preserve the core loop: **observe -> understand -> validate -> update -> check in -> remember the answer**.
- One visible animated pet represents the selected or pinned project. Animation is local, not model-driven frame generation.
- Use real Nemotron calls for project planning, tool selection, evidence interpretation, and structured workspace proposals. Never relabel another model as Nemotron.
- Start with one owner, one Windows installation, one explicitly linked Codex thread per demonstrated project, and one verified source-reading strategy.
- Reading a coding thread must not start/resume a turn, inject messages, approve tools, interrupt work, modify configuration, or alter history.
- Monitoring and source-text export are off until explicit consent. Raw archives, credentials, hidden reasoning, and unrelated threads are excluded.
- MCP is a tool connection, not a transcript-reading permission. Its two proposed tools are an optional extension to the observer, not a replacement.
- No unrestricted generated JavaScript, remote shell, autonomous code edits, purchases, social publication, or production deployment from the project manager.
- SMS, advanced presence routing, full second-PC observation, other harness adapters, arbitrary PDF extraction, and voice/3D pets are not on the critical path.
- Preserve authentication, source scope, idempotency, stale-result rejection, evidence labels, and user drafts even in the hackathon version.
- A mock, imported recording, or fixture must remain labeled as such. Do not present fallback manual import as automatic observation.
- The plan does not authorize provision of paid infrastructure, access to private histories, or modification of existing repositories. Implementation uses a deliberately selected workspace and authorized accounts.

### 16.3 Worker instructions to paste at dispatch

**Shared preamble**

> Implement only the assigned tasks in `living-playbooks-master-plan.md`, using the frozen contract commit supplied by Lead. Preserve unrelated changes. Do not edit another lane's files, add dependencies, weaken tests, read private source histories, activate paid services, or deploy without the necessary explicit authorization. Use fixtures until a live gate is authorized. Model output and source text cannot grant permissions. Record failing tests before implementation, passing checks afterward, and actual unverified items. Do not spawn more agents. Finish with RESULT / CHANGED FILES / CONTRACT IMPACT / TEST COMMANDS AND OUTPUTS / LIVE EVIDENCE / BLOCKERS / COMMIT.

## 6. Persistence and concurrency

### 6.1 Cloud schema

Use straightforward SQL migrations and parameterized `pg` queries. Do not introduce an ORM/code-generator migration project solely for the hackathon.

| Table | Minimum purpose and constraints |
|---|---|
| `owners` | Single operator-provisioned owner, confirmed timezone, reminder preferences |
| `credentials` | Hashed one-use pairing grants and scoped access credentials; kind, owner, device, expiry, consumed/revoked times; never store bearer plaintext |
| `projects` | Owner, revision, epoch, canonical JSONB project state and workspace spec, status; row lock for mutation |
| `source_bindings` | Project/device, opaque source identity, consent mode/revision, state and freshness; no local absolute paths |
| `observations` | Immutable permitted observation data, binding/grant/source identity; unique source-item-version key |
| `messages` | Project manager chat only, owner/manager roles, operation/job correlation; coding transcripts remain observations |
| `documents` | User document bodies and independent revision; project plus document unique key |
| `jobs` | Type, project, immutable input references, state, `runAfter`, lease/generation, tries, sanitized result/error |
| `checkins` | Subject/task revision, question, due/expiry, state, answer, presentation identity; one open routine question/project |
| `command_receipts` | Actor/operation unique key, canonical request hash, result, event sequence |
| `events` | Increasing sequence, owner/project, kind, resource reference and revision; minimal payload for SSE/snapshot recovery |

Keep task and decision arrays inside `projects.state` for the small MVP. This avoids unnecessary joins while allowing atomic revision checks. Split them into separate tables later only if measured requirements justify it.

### 6.2 Transaction rules

A domain command authorizes the caller, checks its receipt, locks the project row, verifies the expected revision, mutates state, appends an event, records any needed job/check-in and the receipt, then commits. The same transaction creates the durable work record; do not depend on an in-memory callback to remember it afterward.

External API/model calls never execute inside a database transaction. A worker claims a job, captures its project revision/epoch and grant versions, releases the transaction, performs bounded work, then rechecks those values before commit.

A stale proposal is not partially merged by guesswork. Mark it superseded, retain a safe diagnostic, and schedule at most one replacement against current state. After two stale generations for the same burst, wait for a quiet interval or explicit user input rather than churn indefinitely.

### 6.3 Minimal durable dispatcher

The cloud process runs one dispatcher with a heartbeat and lease generation. Use transactional row claims such as `FOR UPDATE SKIP LOCKED` for due jobs; that mechanism is documented for queue-like access [R6].

Use a 180-second lease renewed every 30 seconds while the 120-second bounded job is active. Capture and recheck lease generation at commit. On startup, reconcile expired jobs before claiming new ones. A lost lease prevents old completion from committing. An unknown interrupted model call may have incurred provider usage even when its output was not saved; do not claim exactly-once inference or zero cost. At most one bounded retry is allowed where policy permits, and it counts toward usage limits.

A provider timeout does not retry indefinitely. Authentication and unsupported-schema errors are blockers. An invalid proposal may get one repair call only inside the same four-call budget; otherwise retain the last valid project view.

No public side effects are part of the base runner. Optional SMS would need a separate durable intent/reconciliation path, not the generic job retry behavior.

### 6.4 Owner and source changes during work

An owner correction sets the affected task's `ownerOverride` and records a decision. Nemotron can suggest revisiting it but cannot silently replace it. Revoking a source increments its grant revision, rejects queued uploads, invalidates dependent in-flight proposals, removes retained excerpts when requested, and withdraws or marks derived claims requiring review. Track observation dependencies on generated replies and summaries so source-derived excerpts can also be removed or made unavailable there. Minimal tombstones retain no transcript body. An old offline queue cannot recreate revoked text.

## 7. Cloud API and client contract

`packages/api-client` is coordinator-owned and generated/implemented against the shared schemas. The React UI consumes this interface, not hard-coded mock-only data paths.

### 7.1 HTTP endpoints

| Method/path | Caller and effect |
|---|---|
| `GET /health/live` | No secrets, no project data; process liveness |
| `GET /health/ready` | Minimal readiness; detailed diagnostics require owner authority |
| `POST /v1/auth/redeem` | Exchange one-use pairing grant for a scoped credential; rate-limited |
| `GET /v1/projects` | Owner lists compact project summaries |
| `POST /v1/projects` | Create project and initial plan job from a bounded brief |
| `GET /v1/projects/:id/snapshot` | Authorized bounded snapshot and event sequence |
| `POST /v1/projects/:id/actions` | Typed owner actions: accept plan, update task, record decision, pause/resume project |
| `DELETE /v1/projects/:id` | Explicit owner deletion; fence jobs/grants, remove content, retain minimal non-content replay tombstones |
| `POST /v1/projects/:id/messages` | Persist owner message and queue response; returns accepted receipt/job ID |
| `PUT /v1/projects/:id/documents/:documentId` | Revision-checked explicit user draft save |
| `POST /v1/projects/:id/sources` | Enroll an opaque device binding with explicit disclosure policy |
| `POST /v1/sources/:id/state` | Owner/device pause or resume within the existing grant; cannot expand disclosure or select a new source |
| `POST /v1/sources/:id/revoke` | Current owner/device authority; fence exports and invalidate dependent work |
| `POST /v1/sources/:id/observations` | Device ingestion, bound to the authenticated source/project |
| `POST /v1/sources/:id/health` | Safe timestamps/mode/error class only; never creates inference by itself |
| `GET /v1/events?after=<seq>` | Authorized SSE invalidations; current permissions are rechecked |
| `POST /v1/checkins/:id/presented` | Desktop acknowledgment of an actual presentation attempt |
| `POST /v1/checkins/:id/answer` | Authenticated owner answer, idempotent, subject revision checked |
| `POST /v1/checkins/:id/snooze` | Explicit due time, user timezone, revision and deduplication checks |
| `POST /v1/checkins/:id/cancel` | Stop that question; does not mark its task done |
| `POST /v1/jobs/:id/cancel` | Owner cancellation fences completion and aborts owned model request if possible |

All mutating domain endpoints use `CommandEnvelope`. Source observation metadata can identify a source item but cannot select another owner. HTTP status conventions: 401 missing/expired auth, 403 denied, 404 unavailable object without cross-project leakage, 409 revision/idempotency conflict, 422 invalid contract, 429 bounded usage/rate limit, 503 unavailable dependency.

### 7.2 Client interface

```ts
interface PlaybooksClient {
  listProjects(signal?: AbortSignal): Promise<ProjectSummary[]>;
  createProject(input: CommandEnvelope<CreateProjectInput>): Promise<AcceptedJob>;
  getSnapshot(projectId: string, signal?: AbortSignal): Promise<ProjectSnapshot>;
  sendMessage(projectId: string, input: CommandEnvelope<MessageInput>): Promise<AcceptedJob>;
  applyAction(projectId: string, input: CommandEnvelope<OwnerAction>): Promise<CommandReceipt<Project>>;
  saveDocument(projectId: string, documentId: string, input: CommandEnvelope<DocumentInput>): Promise<CommandReceipt<DocumentDraft>>;
  answerCheckIn(id: string, input: CommandEnvelope<CheckInAnswer>): Promise<CommandReceipt<CheckIn>>;
  snoozeCheckIn(id: string, input: CommandEnvelope<SnoozeInput>): Promise<CommandReceipt<CheckIn>>;
  subscribe(after: number, onEvent: (event: ProjectEvent) => void, signal: AbortSignal): Promise<void>;
}
```

`ProjectSummary`, input schemas, `AcceptedJob`, and `ProjectEvent` are defined in T01, not invented independently by lane authors. `AcceptedJob` includes the receipt, job ID, and actual state; it is never a fabricated completed result.

### 7.3 SSE rules

SSE carries `{seq, projectId, kind, resourceId, revision}` and no full source transcript. Receiving an event invalidates the relevant bounded snapshot. Reconnect from the last accepted sequence; a missing/expired cursor requires a fresh authorized snapshot. Keep an offline indicator until refreshed.

The desktop main process authenticates the stream and forwards safe events to the renderer. It never exposes the bearer token through preload. The optional phone uses a same-origin authenticated cookie. SSE is a notification path, not the canonical record or an approval channel.

## 8. Nemotron execution loop

### 8.1 Essential integration

Use a small typed adapter, not an entire new agent framework. The configured endpoint/model must pass a real capability probe: authenticated response, one function tool call, a tool-result continuation, and output that passes the shared schema. NVIDIA documents these features on particular endpoints, but availability and settings vary [R1].

Record the exact endpoint/model and actual request settings. No hard-coded assumption about a free tier, unlimited credits, a particular reasoning setting, or an untested model alias. Never silently substitute another provider.

### 8.2 Proposed interfaces

```ts
interface NemotronAdapter {
  probe(signal: AbortSignal): Promise<ModelCapabilityReport>;
  next(input: ModelTurnInput, signal: AbortSignal): Promise<ModelTurnResult>;
}
interface ProjectManagerRunner {
  run(job: ManagerJob, context: AuthorizedProjectContext, signal: AbortSignal): Promise<ManagerProposal>;
}
```

Freeze those DTO schemas in T01. Native provider-specific message formatting stays inside `packages/nemotron`, not in UI or project records.

### 8.3 Allowlisted tools

| Tool | Allowed behavior |
|---|---|
| `read_project_state` | Read the assigned project's current brief, accepted tasks, decisions, and source health |
| `list_recent_evidence` | List bounded metadata for observations still covered by current grants |
| `read_evidence` | Read a bounded permitted excerpt by ID, not an arbitrary URL/path |
| `read_project_document` | Read a project-owned draft explicitly available to this manager |
| Optional `read_github_pr` | Read metadata/check status for one owner-approved repository/PR; no write token or arbitrary URL fetching |

The tools return real stored/source data with provenance. They do not create facts or silently execute mutation requests. The final structured proposal is applied by the domain validator. A live demonstration must show an actual model-selected tool and follow-up interpretation, not only a model call that produces a prefilled page.

### 8.4 Processing algorithm

1. Claim a due job and capture current project/grant revisions.
2. Assemble the bounded brief, unresolved tasks, latest owner input, and evidence IDs. Do not preload unrelated threads or the entire archive.
3. Invoke Nemotron with the allowed tools and structured final-result schema.
4. Validate each tool name/arguments, enforce scope, execute it, and return bounded results. Record tool name, input references, result digest, and timing without secrets or hidden reasoning.
5. Stop within the call/tool/deadline limits. An empty change set is a valid outcome.
6. Validate returned IDs, task statuses, evidence references, component types, question bounds, and semantic restrictions. A model cannot promote itself to owner or create an unsupported verification label.
7. Recheck project revision/epoch and source grants in a new transaction, commit accepted changes once, and append a minimal event.
8. Update UI from the committed state, not streamed partial JSON. A reply may explain uncertainty but cannot override the record.

### 8.5 Avoid loops and cost surprises

Only meaningful new evidence, owner messages, or an explicitly scheduled review can request reflection. Heartbeats, UI redraws, pet animation, SSE reconnection, and the model's own accepted update must not recursively schedule more inference.

Persist call counts and last error. Configure a finite account-wide request/token allowance at setup. Unknown dollar cost is shown as unavailable; it is not zero. Handle provider 429/reset information with queue backoff, not account rotation.

## 12. Check-ins and notification behavior

### 12.1 Responsibility split

Nemotron can propose a useful question and its subject. The domain service decides whether the subject exists, whether reminder consent exists, and whether it is eligible under current rules. The dispatcher checks due rows. The desktop decides only how to display a server-authorized question under local focus/hide settings.

The model does not decide that lack of typing means the person has stopped working. Advanced OS-idle and cross-device absence routing are deferred.

### 12.2 Minimal lifecycle

```text
scheduled -> available -> presented -> answered
    |            |            |
    +------------+------------+-> snoozed -> scheduled
    +------------+------------+-> cancelled / expired
```

Persist one logical question ID through all views and snoozes. Immediately before availability/presentation, recheck task revision, project status, expiration, current consent, quiet hours, unresolved-question limit, and account attention budget.

Recorded changes the intended task to done with `user_reported`. Not yet records the answer without guessing a new deadline. Snooze records a user-selected due time. Skip is an explicit scope decision, not completion.

### 12.3 No duplicate pet interruptions

One desktop is the initial notification destination. Before showing a bubble, main persists its `(checkInId, presentationId)` in the local journal and then presents it. It acknowledges successful display afterward. On ambiguous crash/reconnect, retain the question in the in-app inbox rather than repeatedly displaying the same proactive bubble. This favors a missed interruption over a duplicate; it does not claim exactly-once human perception.

The question remains answerable even if a bubble was hidden. Reading or showing a question is not proof that the user read it.

### 12.4 Test and demonstration clock

Tests inject a clock and must not sleep for real reminder intervals. A deliberate demo policy can shorten due times to 20 seconds and must display **Demo reminder timing** in the UI and evidence report. It is not a production quiet-hours bypass and cannot enable SMS.

If the cloud is offline or its timer process is not running, mark timing unavailable. A regular in-process interval is acceptable only because its due work is stored and the deployment is always running; it is not a durable scheduler inside a sleeping request-only service.

## 14. Security, deployment, and resource limits

### 14.1 One-owner authentication

Use an operator CLI against the configured cloud database to create a cryptographically random, one-use pairing code with a ten-minute expiry. Store its hash. The desktop redemption returns a device-scoped random token only to main; store its hash server-side, revoke it independently, and protect its local copy. Use a 48-hour demo credential expiry with explicit revocation after the event, not a permanent secret in a browser bundle.

All project endpoints require authorization. No public signup, password recovery, or guessed six-digit secret is needed. The operator database credential is never shipped to the desktop. Rate-limit redemption attempts. Reject expired/reused grants in a single transaction.

The optional phone session cannot mutate projects. Source enrollment and revocation are authenticated owner/device actions, never manager/MCP permissions. Enforce the same scope in tests even with one provisioned owner, using a second synthetic owner as a negative fixture.

### 14.2 Deployment

Choose one already-authorized hosting route that supports an always-running Node process, outbound TLS, a reachable PostgreSQL database, and SSE. The provider is not prescribed and no purchase is authorized by this document. Use a single replica initially; lease fencing still protects restart overlap.

Apply migrations explicitly, verify `/health/ready`, confirm model access, and restart once before considering the deployment usable. Store the model key, database URL, and cookie/session material in server-side environment/secret settings. The hosted web build must contain no provider or admin secret.

Local development can use an existing local PostgreSQL or one disposable container. Do not install a large new infrastructure stack to satisfy this plan. If no persistent cloud is available, label a local-only demonstration as partial rather than claiming laptop-independent operation.

### 14.3 Retention and logging

Keep model/provider request metadata and tool receipts without hidden reasoning or secrets. Avoid logging raw thread content. For the hackathon, use synthetic/private-safe source data and a visible cleanup command. Store approved excerpts for at most seven days by default, facts until project deletion, and minimal non-content deduplication tombstones needed for delivery safety. Provider retention is separate and must not be inferred from local deletion.

Support pause, revoke, and delete-project flows. Revocation takes priority over upload retry. Generated text cannot alter those policies. Empty/error/unknown data is never silently filled with guessed facts.

### 14.4 Health and performance

Measure observation delay, ingestion time, model time, snapshot refresh, and reminder availability separately. Do not promise subsecond semantic updates. Initial acceptance is one active polling/inference cycle with honest timestamps, zero inference from idle animation, bounded journals, and no repeated questions from duplicates.

No continuous screen capture, keylogging, window-title surveillance, voice recording, or hidden browser automation is part of this app.

### 14.5 Configuration and feature flags

The following are names to put in `.env.example` or a validated local settings schema, not actual credentials. Invalid/missing required live settings block only the live path and never enable mocks silently.

| Setting | Owner and behavior |
|---|---|
| `DATABASE_URL` | Cloud only; authenticated persistent PostgreSQL connection |
| `PUBLIC_ORIGIN` | Cloud trusted HTTPS origin; exact allowlist, no wildcard credentials |
| `NVIDIA_API_KEY` | Cloud secret only; never returned to desktop or committed |
| `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL` | Explicit tested route/model, fixed for a run |
| `LP_MODEL_CALL_BUDGET` | Positive finite owner-configured event budget; live inference stays disabled until set |
| `LP_JOB_DEADLINE_MS=120000` | Bounded runner deadline |
| `LP_DEMO_TIMING=false` | Only explicit demonstration mode may shorten reminder timing, with visible badge |
| `LP_ENABLE_MCP=false` | Optional two-tool bridge enabled only after its own gate |
| `LP_ENABLE_PHONE_VIEW=false` | Optional read-only phone session and responsive view |
| `LP_ENABLE_SMS=false` | Must remain false unless separately implemented and verified |
| `LP_FIXTURE_MODE=false` | Explicit test/demo-fixture mode; never a fallback from live failure |
| `LP_CLOUD_ORIGIN` | Desktop configured destination, not model-selectable |

Source-read consent and excerpt-export consent are persisted grant records, not global environment switches. Feature flags cannot override an owner's denied source permission.

### T02. Build cloud persistence, one-owner auth, and core API

**Owner:** A. **Depends on:** T01.
**Files:** `apps/cloud/src/db/*`, `auth/*`, `api/{projects,sources,observations,events}.ts`, `domain/{commands,projects,evidence}.ts`, `tests/cloud/{auth,receipts,scope,ingestion}.test.ts`.
**Interfaces:** `authorize(principal, action, resource)`, `applyCommand(envelope, principal)`, `ingestObservations(bindingId, envelope, principal)`, `loadSnapshot(projectId, principal)` with shared DTOs.

- [ ] Write tests for single-use pairing, expiry, revoked tokens, cross-owner denial, same-operation replay, changed-payload conflict, duplicate source items, a revoked/paused binding, and project deletion fencing pending jobs before content removal. Use an actual disposable PostgreSQL instance for transaction tests.
- [ ] Run `pnpm test:cloud` with the pinned single-worker transaction-test configuration from T00. Verify the relevant failures before implementing; do not introduce unsupported runner flags.
- [ ] Implement the schema/migration, hashed tokens, parameterized queries, row-locked project commands, ingestion validation, and receipts/events in the same transaction. Return accepted jobs, not fabricated model completions.
- [ ] Add authenticated snapshots/SSE and bootstrap CLI `owner:grant`. Recheck authority on reads and writes. Keep provider/database credentials out of response bodies.
- [ ] Run `pnpm db:migrate`, `pnpm test:cloud`, and `pnpm typecheck`; provide the exact fixture responses and migration commit for J1.

**Exit gate:** A real owner-authenticated project and observation persist once, wrong scopes are denied, and an API restart returns the same snapshot.

### T03. Implement the bounded Nemotron manager loop

**Owner:** A. **Depends on:** T02.
**Files:** `packages/nemotron/src/{adapter,runner,tools,proposal-validation}.ts`, `apps/cloud/src/jobs/*`, `tests/cloud/{manager,leases,stale-proposal,model-errors}.test.ts`.
**Interfaces:** `NemotronAdapter.next`, `ProjectManagerRunner.run`, `claimJob`, `commitProposal(jobId, leaseGeneration, proposal)`.

- [ ] Write tests for tool name/scope denial, real evidence IDs, invalid component JSON, unsupported model response, input/output/tool budgets, no-op result, no recursive job from its own output, and an owner correction while a delayed model response is in flight.
- [ ] Run the focused manager tests and confirm expected failures.
- [ ] Implement the adapter and read-tool loop, durable claims with lease generation, bounded retry, project/grant revalidation, and atomic proposal commit. Do not expose direct SQL, arbitrary fetch, or source-grant tools to the model.
- [ ] Verify 200/streamed completion behavior on the selected endpoint. An asynchronous 202 is not success: implement only documented bounded polling for that exact route, or report unsupported pending state without blindly submitting another request.
- [ ] Run deterministic tests and, only when authorized, `pnpm test:live:model` using synthetic data. Retain safe model/tool receipts and deliver J2 evidence.

**Exit gate:** A real model uses a real read tool, returns a schema-valid proposal, and stale or unauthorized proposals cannot update the project.

### T08. Implement persisted check-ins and owner answers

**Owner:** A. **Depends on:** T03.
**Files:** `apps/cloud/src/checkins/{policy,scheduler,commands}.ts`, `api/checkins.ts`, `tests/cloud/{checkin-policy,checkin-races,checkin-restart}.test.ts`.
**Interfaces:** Due-question candidate validation, listed check-in routes, shared `CheckInAnswer` and `SnoozeInput`.

- [ ] Write fake-clock tests for quiet hours, account caps, one open question/project, duplicate scheduling, answer-before-display, task completion before due time, pause, revocation, snooze, and DST-aware timezone rendering/next eligibility.
- [ ] Run focused tests and confirm intended failures.
- [ ] Implement durable due records and the 15-second dispatcher, rechecking current authority/subject before making a question available. Do not call Nemotron merely because the timer ticks.
- [ ] Answer/snooze/cancel transactions update the correct task/question and persist receipts. Recorded means user-reported; skipping or dismissal does not mean completion.
- [ ] Rerun tests and restart the cloud process with a question pending. Confirm due and snoozed work survive without a duplicate question or lost answer.

**Exit gate:** A real saved question becomes available once under policy and responds correctly to owner input.
