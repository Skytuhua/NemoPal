# Lane B requirements excerpt

Source: owner-approved living-playbooks-master-plan.md. Frozen contracts and docs/contracts-v1.md resolve implementation DTO details. Only B-owned native/observer work is assigned; C owns renderer/art.

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

## 9. Codex observation and privacy

### 9.1 Decide the route early

T00 must prove one compatible route on the actual Windows installation using a harmless user-selected thread. The plan does not assume that an App Server process can see another process's live state.

**Preferred candidate:** the official App Server's supported stored-history reads. Current documentation describes thread listing, metadata reads, and paginated history methods; reading history is different from resuming/subscribing [R2]. Pin the installed version and its supported methods. Reject unknown operations.

**Explicit fallback:** a version-specific, read-only parser for one user-selected persisted session file, only when the user permits that mode. Validate its actual record format before use. Do not recursively scan the entire profile or label a user-input history file as a complete conversation.

Enrollment follows new records from a known baseline by default. Any bounded historical import requires a separate explicit choice and remains identified as imported history; no automatic backfill of the archive. Implement the route that passes. Do not build both fully during the event. If neither works, retain a clearly marked manual-import/MCP-report fallback and mark automatic observation blocked. Do not conceal that loss of the core capability.

### 9.2 Observer interface

```ts
interface CodexObserver {
  probe(): Promise<ObserverCapabilityReport>;
  readDelta(binding: LocalBinding, cursor: SourceCursor | null, signal: AbortSignal): Promise<ObservationBatch>;
  stop(bindingId: string): Promise<void>;
}
```

`LocalBinding` contains local resolved identity, the explicitly chosen thread/file, privacy policy, and grant revision. It is never sent wholesale to the cloud. `ObservationBatch` includes normalized records, a next cursor, mode, source freshness, and coverage limitations.

An API observer allows only its pinned read methods and required handshake, with a separate denylist test for start/resume/fork/inject/approval/interrupt/archive/exec operations. App Server initialization may have implementation side effects; test noninterference rather than claiming absolute filesystem purity.

A file observer opens read-only, checks the selected regular file's identity, handles partial lines, uses byte-safe cursors, and stops on unknown schema, truncation, replacement, or rotation requiring renewed validation. Persist normalized records and the corresponding next cursor atomically before upload. A cursor must never advance past records not durably queued.

### 9.3 What may be exported

Before consent: nothing except a user-invoked capability probe's non-content diagnostics.

After metadata consent: safe item types, timestamps, completion/exit-status metadata where supported, and freshness. This does not supply detailed semantic progress.

After explicit excerpt consent: bounded completed user-visible messages in the linked thread, excluding hidden reasoning, encrypted/internal fields, credentials, diffs, arbitrary command arguments, stdout dumps, and unrelated attachments. Tool metadata does not include raw output unless a separately implemented and consented mode is added later.

The consent screen identifies the cloud model endpoint, project, device, source, sample data classes, pause/revoke controls, and the fact that secret filtering is best-effort. Do not infer consent from installing MCP or creating a project.

### 9.4 Mapping and honest status

Bind explicit thread identity plus validated source/workspace metadata, not matching folder names. Only one source binding is required for the first demonstrated project. UI states include history-only, incremental history, stale, and blocked. Never show a generic “connected” indicator as proof of automatic new-message access.

An agent's “finished” message is `agent_reported`. A user clicking Recorded is `user_reported`. A parsed source command exit is `source_tool_observed` for that command only. Missing events mean no new evidence, not failure or inactivity.

### 9.5 Consent revocation

Revoke locally immediately, stop polling, clear pending content exports, and call the cloud revocation endpoint when connected. The cloud checks current grant revisions on ingestion and model commit. Until server confirmation, show “local monitoring stopped; cloud revocation pending” rather than claiming the cloud already forgot the content.

Do not promise to recall information already processed by a model provider. For the prototype, support removing stored excerpts and invalidating derived summaries; document provider-retention limitations separately.

## 10. Desktop companion, local queue, and pet

### 10.1 Process lifetime

One Electron main process owns the companion. The main project window and a small pet window are separate renderers. Closing the project window minimizes/closes that view while the tray companion remains running, with an explicit onboarding explanation. Quit stops polling and sync, flushes the local journal, and exits. Do not install an invisible OS background service or autostart without a separate user choice.

Use a single-instance lock so two app launches cannot become two observers. Suspending the PC stops observation naturally; resume triggers cursor/source revalidation and cloud synchronization before showing a pending question.

### 10.2 Narrow preload API

```ts
interface DesktopBridge {
  capabilities(): Promise<DesktopCapabilities>;
  pair(input: PairingInput): Promise<PairingResult>;
  selectSource(projectId: string): Promise<SourceSelectionPreview>;
  confirmSource(input: ConfirmSourceInput): Promise<SourceBinding>;
  pauseSource(bindingId: string): Promise<void>;
  revokeSource(bindingId: string): Promise<void>;
  invoke(input: AllowedClientCommand): Promise<unknown>;
  onEvent(listener: (event: SafeDesktopEvent) => void): () => void;
  setPetPreference(input: PetPreference): Promise<void>;
}
```

The main process validates sender window/frame, current app origin, schema, project, size, and allowed operation. `invoke` is a discriminated union of known actions, never an arbitrary URL/method/SQL/shell proxy. The pet preload is smaller: show project, answer/snooze the displayed question, change pet preference, and receive safe pet events.

Renderers use `nodeIntegration: false`, `contextIsolation: true`, sandboxing where supported, a restrictive CSP, and denied unexpected navigation/popups. Package local renderer code. Electron warns against giving untrusted remote content native privileges [R3].

### 10.3 LocalStore contract

```ts
interface LocalStore {
  commitObservationBatch(bindingId: string, expectedCursor: SourceCursor | null, batch: ObservationBatch): Promise<void>;
  pendingUploads(limit: number): Promise<PendingUpload[]>;
  acknowledgeUploads(ids: string[]): Promise<void>;
  revokeBinding(bindingId: string, grantRevision: number): Promise<void>;
  recordPresentation(checkInId: string, presentationId: string): Promise<boolean>;
  flush(): Promise<void>;
}
```

For the base, use a bounded application-owned journal written with one mutex, a temporary file, flush, and same-volume rename. Keep the previous valid snapshot for recovery where supported and test actual Windows rename behavior. A corrupt journal pauses ingestion rather than resetting the cursor and silently replaying history. This store is deliberately not a scalable event database.

Device credentials use the supported OS-protected Electron storage API available in the pinned build, with no plaintext fallback. Current documentation distinguishes async and older sync APIs and notes Windows protection is not isolation from other applications running as the same user [R4]. If protected storage is unavailable, allow an explicitly temporary in-memory session, then require re-pairing after exit.

Pause collection at the spool limit and expose the blocker. Never discard pending observations while advancing the source cursor to appear healthy.

### 10.4 Pet behavior

Use an original or license-verified sprite pack. Render six states locally at a bounded frame rate, reduce motion when requested, and stop animating when hidden. The pet's name/icon comes from the selected project manager.

Use a small frameless transparent topmost window, not a full-screen invisible window. Transparent pixels are not automatically click-through; either keep a tiny interactive rectangle or explicitly enable whole-window click-through with a tray escape control. No focus theft. Do not attempt to appear above secure desktops or claim universal fullscreen behavior [R5].

A question bubble is an actual `CheckIn`, not freshly generated prose from a second pet model. The bubble offers Recorded/Not yet/Snooze/Open project as appropriate. A tray Hide or Focus switch must work without cloud access.

Persist position in the work area. If a monitor disappears, clamp it to an available display. Protect project chat and draft identity when the selected pet changes.

### T04. Build the native shell and pet window boundary

**Owner:** B. **Depends on:** T01.
**Files:** `apps/desktop/src/main/{index,windows,tray,ipc,credentials}.ts`, `apps/desktop/src/preload/{workspace,pet}.ts`, `tests/desktop/{ipc,window-lifecycle,credentials}.test.ts`.
**Interfaces:** Typed `DesktopBridge` and `PetBridge` from T01; C supplies the renderer build and pet component.

- [ ] Write tests for single instance, denied arbitrary IPC, wrong sender frame, no token return to renderer, Quit teardown, and hiding the main window without stopping the explicitly running companion.
- [ ] Run `pnpm test:desktop`; verify failures before implementing the boundary.
- [ ] Implement local packaged renderer loading, secure web preferences, small pet window, tray controls, protected token storage, and a source-selector placeholder that cannot accept arbitrary renderer paths.
- [ ] Test the actual Windows overlay: no unwanted focus, Hide/Open/Quit, click-through escape, work-area clamping, display change, and reduced motion. A normal in-app pet is a fallback, not proof of the overlay.
- [ ] Rerun tests, capture a safe native smoke receipt, and hand C the exact tested IPC/screen route without changing shared contracts privately.

**Exit gate:** A native pet window and main window coexist, controls work, and remote/model content cannot invoke native powers.

### T05. Implement one automatic read-only Codex observer

**Owner:** B. **Depends on:** T04 and the T00 strategy decision.
**Files:** `packages/codex-observer/src/{index,adapter,normalizer,cursor}.ts`, `fixtures/codex/*`, `tests/desktop/{observer-readonly,observer-cursor,observer-privacy}.test.ts`.
**Interfaces:** `CodexObserver.probe/readDelta/stop`, `ObservationBatch`, `SourceCursor`.

- [ ] Write fixtures for final visible messages, permitted exit metadata, partial/truncated records, duplicate items, an unexpected format, hidden reasoning, secrets, unrelated thread IDs, and source replacement.
- [ ] Run focused tests to prove rejection/no cursor advance on unsafe input.
- [ ] Implement only the selected route with a hard method/read allowlist and bounded incremental reading. No start/resume/interrupt/inject/approval calls. Default to following new records from an enrolled baseline, not bulk backfill.
- [ ] After explicit permission, observe two fresh source updates on the target Windows configuration; prove no new harness turn, permission change, or tool invocation was initiated by the observer. Document any incomplete/live-state limitations.
- [ ] Rerun tests and hand over normalized events with exact provenance. Preserve an unavailable mode instead of guessing if compatibility changes.

**Exit gate:** One real selected source produces new usable observations automatically and without interfering with the coding workflow.

### T07. Connect consent, local durability, and cloud synchronization

**Owner:** B. **Depends on:** T02, T05; UI controls from T06 can be mocked until joined.
**Files:** `apps/desktop/src/main/{consent,local-store,sync,source-controller}.ts`, `tests/desktop/{spool,revoke,reconnect}.test.ts`.
**Interfaces:** `LocalStore`, cloud source/observation routes, confirmed `LocalBinding`.

- [ ] Write tests for zero content reads before source permission, zero text export before excerpt consent, atomic cursor+records, lost response/retry, queue full, corrupt journal, and revocation while offline.
- [ ] Run the focused tests and confirm the failures.
- [ ] Implement native selection, separate local-read/cloud-share consent, opaque source IDs, best-effort filtering, bounded atomic journal, ordered upload retry, and acknowledged pruning.
- [ ] Join the actual cloud client. Pause/revoke prevents further collection immediately; queued old-grant exports are rejected server-side. A revoked or invalid pairing token shows a real blocker, not a login loop.
- [ ] Run desktop tests and an authorized live disconnect/reconnect scenario. Capture counts proving one source event creates one observation and one logical downstream update.

**Exit gate:** The selected source reaches the correct project once; loss of connectivity and consent changes do not lose or disclose unauthorized data.

### T09. Join pet presentation with real check-in interaction

**Owner:** C for rendering, B for its owned IPC transport; no shared-file edits. **Depends on:** T04, T06, T08 for acceptance.
**Files:** `apps/web/src/pet/*`, `assets/pet/*`, `apps/web/src/features/checkins/*`, B-owned `apps/desktop/src/main/presentation.ts`, `tests/ui/pet.test.tsx`, `tests/desktop/presentation.test.ts`.
**Interfaces:** `SafePetEvent`, restricted `PetBridge`, `CheckIn` and answer/snooze commands.

- [ ] Write tests for project/pet identity, deterministic states, question display dedupe, local focus/hide preference, repeated SSE event, and answer reflected in both pet and project view.
- [ ] Run UI and desktop focused tests, each lane owning its failure/implementation.
- [ ] C implements sprite state/rendering and concise bubbles; B implements persisted presentation identity, window visibility, and safe forwarding. No independent pet scheduler or model calls.
- [ ] Add explicit demo timing label and normal snooze controls. Animation state precedence is cloud-disconnected/offline, local snoozed, valid question, new milestone, reviewing, idle. A stale Codex source alone is not a cloud-offline state.
- [ ] Rerun tests and perform the real Windows question/answer cycle while the main window is closed to tray.

**Exit gate:** The actual desktop pet asks a valid question, respects local controls, and saves the answer without focus theft or repeated reminders.
