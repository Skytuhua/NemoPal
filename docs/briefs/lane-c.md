# Lane C requirements excerpt

Source: owner-approved living-playbooks-master-plan.md. Frozen contracts and docs/contracts-v1.md resolve implementation DTO details. Only C-owned React/art is assigned; B owns native transport.

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

## 11. Project-first UI and generative catalog

### 11.1 Layout and states

The center receives the majority of space. Left sidebar: project name, pet icon, one status, and unread question marker. Center: goal, current next action, working panels, and source freshness. Right: only the selected manager's conversation.

At narrow widths, show one main surface at a time with explicit Projects/Workspace/Chat navigation. The optional phone is read-only initially, including disabled mutation controls with explanations. Do not quietly broaden it into a second source-management device.

Every main surface needs empty, loading, ready, updating, offline/stale, error, and paused states. Persist user drafts before switching project. A late response for project A cannot populate project B's selected view.

### 11.2 Six components

| Component | Backing record | Allowed interaction |
|---|---|---|
| Checklist | Canonical tasks | Explicit owner status correction with evidence label |
| Milestone timeline | Tasks grouped by phase/due date | Inspect milestone and source; no fabricated percentage |
| Evidence card | Authorized observation IDs | Expand supporting excerpt/metadata and freshness |
| Question card | CheckIn ID | Answer, snooze, cancel, open linked task |
| Document editor | DocumentDraft ID | Explicit revision-checked save; preserve conflict copy |
| Next-action card | Existing task/decision references | Navigate or propose a bounded action; no arbitrary execution |

`WorkspaceSpec` chooses component types, order, headings, and data IDs. It cannot contain script, CSS selectors, external asset URLs, arbitrary HTML, JavaScript expressions, privileged controls, or raw credentials. Do not create arbitrary nested layouts in the first version.

### 11.3 Preserve working state

Stable panel IDs survive data updates. Layout changes do not overwrite document bodies, collapse an actively edited panel, move a control underneath a click, or steal focus. Apply routine value updates from canonical state; show a small preview/apply control for structural rearrangements during active editing.

Store drafts in IndexedDB or the existing proven journal approach. Do not use localStorage for bearer credentials. A rejected model layout keeps the last accepted layout and a plain trusted checklist fallback.

### 11.4 Mock mode

A shared fixture client implements `PlaybooksClient`. It is selectable only through explicit development/test configuration and visibly labeled. All UI lanes can begin with that client before the API is complete. Release/demo mode cannot automatically fall back to mock success on network or model failure.

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

### T06. Build the project-first workspace and six-component renderer

**Owner:** C. **Depends on:** T01.
**Files:** `apps/web/src/app/*`, `apps/web/src/features/{projects,chat,documents,sources}/*`, `packages/project-ui/src/*`, `tests/ui/{workspace,catalog,drafts,project-switch}.test.tsx`.
**Interfaces:** `PlaybooksClient`, `WorkspaceSpec`, `ProjectSnapshot`; never direct database/native access.

- [ ] Write UI tests for a new project with unknown progress, draft plan acceptance, source-reported status labels, invalid-layout fallback, narrow layout, and an A-to-B switch while an A request completes late.
- [ ] Run `pnpm test:ui` and verify failures before implementing.
- [ ] Implement the left project sidebar, center canvas, right chat, trusted status/privacy controls, and exactly six component types using golden fixtures. Use one mock/real client interface.
- [ ] Add draft persistence and document-revision conflicts. Incoming layout changes preserve focused editors and user changes; no empty green dashboard replaces missing data.
- [ ] Run UI tests and keyboard/manual narrow-window checks. Deliver working routes/screens and switch to real snapshots at J1/J2.

**Exit gate:** The workspace can be used without chat for basic task correction and draft editing, and it does not manufacture readiness.

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
