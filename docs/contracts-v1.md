# Frozen contract v1

The source of truth is `packages/contracts/src/`, exported through `index.ts`. Types derive from strict Zod schemas. `fixtures/contracts/golden.ts` supplies all six panels, one permitted observation batch, revocation, and a check-in lifecycle. Only Lead changes schemas/client/root dependencies.

## Shared surfaces

| Consumer | Interface | Required boundary |
|---|---|---|
| Cloud/API + UI | `PlaybooksClient`, `ProjectSnapshotSchema` | Validate both network directions; no implicit fixture fallback |
| Desktop workspace | `DesktopBridge`, `AllowedClientCommandSchema` | Origin/frame/schema/project checks in main; no token in preload |
| Pet renderer | `PetBridge`, `PetCommandSchema`, `SafePetEventSchema` | Display the current question only; no cloud transport or source powers |
| Observer | `CodexObserver`, `LocalBinding`, `SourceCursor`, `ObservationBatch` | Selected source only, read-only, cursor/records committed atomically |
| Queue/cloud | `PendingUpload`, `IngestObservationsInputSchema` | Stable operation IDs; only normalized observations leave the device |
| Manager | `NemotronAdapter`, `ProjectManagerRunner`, model DTO schemas | Tools are read-only and fixed; proposals are revalidated by domain |

`CommandEnvelope` carries an operation ID. `RevisionedCommandEnvelope` additionally requires `expectedRevision`; it refers to the current project for actions/messages/enrollment/deletion, document for draft saves, and check-in for answer/snooze/cancel. Revision lives in the envelope once, rather than duplicated inside an answer. The cloud also checks the question's `subjectRevision` against its task. Source grant commands carry the current `grantRevision`; neither an envelope nor model prose grants authority.

Accepted jobs contain an `accepted` receipt and actual `queued`/`running` state. Completed mutation receipts contain their canonical result. Every receipt includes the canonical hash, project revision, and event sequence. `hashCommand(target, envelope)` includes operation target and JSON arguments; callers must parse/normalize the contract before hashing. For v1 HTTP commands, target is the exact URL pathname (for example `/v1/projects/<uuid>/actions`), excluding origin/query. Both server and client use this convention, and the client checks the returned operation ID, hash, and known target record IDs.

Snooze input is `{ until, timezone }`. Timezone is an explicit IANA name. Questions preserve logical ID and allocate a new presentation identity for a new snoozed presentation; routine retries keep the same presentation identity. No presentation/heartbeat/SSE event schedules inference.

Model-created tasks exclude `revision` and `ownerOverride`, which the cloud derives as 0 and false, and cannot use `requirementOrigin: owner`. Update proposals reference current task revisions. Shape validation alone does not permit model completion labels, overwrite owner decisions, authorize source access, or validate evidence. A owns those semantic checks.

Panels are a flat ordered array: `checklist.taskIds`, `milestone_timeline.taskIds`, `evidence_card.observationIds`, `question_card.checkInId`, `document_editor.documentId`, `next_action.taskId`. Stable IDs are mandatory. Snapshot validation checks all references against included project records. Model proposal validation must resolve references against proposed plus currently authorized entities before persistence. Generated layout never carries draft text, HTML, CSS, assets, scripts, or native commands.

Observation kinds must match metadata and evidence labels. Only completed visible user/assistant message kinds can have excerpts; tool/activity records cannot carry command output via an excerpt. `agent_reported` remains a report. Metadata-only sources never carry excerpts. Final consent, source/device identity, grant revision, and authentic provenance remain server/main obligations.

## Transport and builds

- Cloud development origin is `http://127.0.0.1:4310`; HTTP is for loopback development only. Deployment requires an explicitly configured HTTPS origin.
- API methods/paths/statuses follow master-plan Section 7. Snapshot `eventSequence` is the authorized invalidation watermark. SSE emits strict minimal events; expired cursor requires a fresh authorized snapshot.
- Main executable source: `apps/desktop/src/main/index.ts`; built ESM: `apps/desktop/dist/main/index.js`.
- Preload sources: `apps/desktop/src/preload/{workspace,pet}.ts`; built sandbox-compatible CommonJS: `apps/desktop/dist/preload/{workspace,pet}.cjs`.
- Web Vite config/source belongs to C. Build output is `apps/web/dist`; workspace uses `index.html`, pet uses `index.html?surface=pet`.
- Desktop development may use exact loopback `LP_RENDERER_URL`; packaged mode loads local build only. Validate each renderer/frame against its assigned URL/role.
- `scripts/run-desktop.ts` removes inherited `ELECTRON_RUN_AS_NODE` from the child environment; T3 itself can set it. Native tests must do the same without modifying the user's global environment.
- Root scripts already exist for all master-plan checks. Missing tests/artifacts fail or report blocked; a command name is not proof of implementation.

## Changes after freeze

Send Lead the smallest schema-change request: affected DTO/fields, consumers, reason, migration/fixture/test impact. Do not redefine a competing type in a lane. Lead updates this record, notifies every affected lane, and publishes the integration commit.
