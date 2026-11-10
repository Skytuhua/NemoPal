# NemoPal Dice UI Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paused board experiment with a Dice UI workspace backed by persistent project-specific columns, safe Nemotron proposals and explicit owner actions.

**Architecture:** Keep the existing Electron/React shell and cloud command/queue boundaries. Vendor the pinned MIT Kanban primitive, add a separately validated canonical board, then connect the controlled renderer to revisioned operations. Pet and T3/Sendblue work use separate leaves and release gates.

**Tech Stack:** React 19, Vite, Electron, existing Tailwind 4/shadcn/Geist, Dice UI Radix Kanban, dnd-kit, existing Zod/PostgreSQL backend.

**Spec:** [NemoPal Dice UI board design](2026-11-08-nemopal-dice-board-design.md).

## Current execution priority

The user's latest instruction is to work on the interface first and worry about the pet later. Start Task 1, then the **visual-preview portion** of Task 4. Use an explicit sample-data adapter for the proposed board shape; it must render arbitrary column IDs/titles/membership and multiple task counts, not claim a live Nemotron-generated board or persisted new schema. Preserve the existing fixture disclosure.

Share that working board promptly for visual review. After visual approval, Tasks 2/3 provide real canonical persistence/model behavior, then finish Task 4's production wiring. The user reports Tasks 6/7 are actively owned by side-chat agents; this coordinator must not duplicate those implementations. No further original Overview work or Kan copying.

## Global Constraints

- Interface work is authorized by the latest user instruction; visual approval still gates further migration/integration. Preserve current uncommitted work as reference; do not reset the coordinator or interrupted children.
- Never touch `C:/Users/user/Documents/NemoPlaybook`, its held build/env/key/accounting, or retry blocked J2.
- Board is the sole center workspace. No Overview tab/page. Keep owner notes, drafts, evidence, check-ins, consent and settings.
- Retain 240px/360px preferred sidebars, existing bounds/480px center, 8px handles and drawers below 1100px.
- No Next.js migration, Kan backend, Kan MCP server, arbitrary generated HTML, runtime font CDN or global Tailwind Preflight.
- Pin copied source/dependencies; retain MIT/OFL notices and exact existing font/mouse bytes.
- One focused PR per deliverable, against its dependency branch/integration; immediately link the full stack. Independent code/security review plus applicable visual review precede merge. No main/release merge under this plan.
- No live provider, source/history export, phone send, native GUI, database or deployment operation is authorized by executing offline steps below.

## Review Focus

1. A concurrent move/model response must not overwrite an owner's newer placement: Task 2/3 tests.
2. Ambiguous or stale `this task` must never defer another task: Task 3 tests.
3. Source withdrawal must preserve owner data while removing generated dependent text: Task 3 tests.
4. Shrinking, cancelling a drag or hiding utilities must preserve exact editor/composer identity and keyboard reachability: Task 4 tests.
5. A close animation, repeated question or reduced-motion change must not strand focus or hide a newer pet notification: Task 6 tests.

## Source and ownership

Current committed shell checkpoint: `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`, not visually approved. Current dirty App/board/chat/test changes are paused, not a verified joined candidate. PR40 stays draft/HOLD; PR33 remains unaccepted.

| Deliverable | Exclusive owner / files | Depends on |
|---|---|---|
| Dice foundation | UI foundation worker: new project-ui Kanban/license/provenance, manifests/lockfile, focused primitive tests | Approved design |
| Canonical board | One contracts/persistence worker: contracts, migration, Store actions, fixture parity | Frozen schema below |
| Nemotron board semantics | Same backend owner or sequential model worker: proposal validator, runner, queue, scheduler, withdrawal | Canonical board |
| Sole-board renderer | Lead shell owner: App, TaskBoard, board CSS, Chat wiring, snapshots, UI regressions | Dice + canonical board |
| Pet bubble | Separate worker: Pet, pet CSS, new isolated pet tests; restricted native seam only after review | Approved pet design |
| T3/Sendblue | Separate end-to-end owner after capability/authority contracts freeze | Backend + roadmap gates |

No two workers edit shared contracts, App, main lifecycle, queue or Store simultaneously. Research/review can run in parallel; integration ownership remains with Lead. Workers are not alone and must preserve others' edits. Children deliver before parent acknowledgment/status verification/archive; unfinished/interrupted work stays visible.

## Task 1: Vendor and exercise the Dice Kanban primitive

**Files:** new `packages/project-ui/src/ui/kanban.tsx`, `LICENSE.diceui.md`, `diceui-provenance.json`; modify project-ui exports/package and lockfile; new `tests/ui/dice-kanban.test.tsx`.

**Interface:** retain upstream controlled `Kanban.value`, `onValueChange`, `getItemValue`, item/column handles, overlay and cancellation hooks. NemoPal application mutations remain outside the primitive.

- [ ] Write failing tests for column/card composition, empty-column movement, keyboard movement, disabled handles and cancellation restoring the original controlled value.
- [ ] Run `pnpm exec vitest run tests/ui/dice-kanban.test.tsx --maxWorkers=1 --no-file-parallelism`; record meaningful RED.
- [ ] Verify the exact source bytes/hash in the design, copy the Radix source and MIT license, and record modifications. Adapt imports to local `cn` and public Radix APIs; do not import the documentation app.
- [ ] Pin `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`; use public `@radix-ui/react-compose-refs@1.1.2` rather than `radix-ui/internal`. Retain existing radix-ui 1.8.1. Verify React/Tailwind compatibility in the frozen lockfile. Do not add modifiers unless the copied source actually imports them. No unpinned CLI scaffolding or app replacement.
- [ ] Rerun focused tests/typecheck; commit only the foundation files and open its focused draft PR.

## Task 2: Persist canonical columns and owner moves

**Files:** new `packages/contracts/src/board.ts`; modify contracts `domain.ts`, `api.ts`, `limits.ts`, exports; new `apps/cloud/src/domain/board.ts`, `apps/cloud/src/db/board-migration.ts`; modify `db/migrate.ts`, `schema.sql`, `domain/store.ts`; fixture/client updates in `fixtures/contracts/golden.ts`, `packages/api-client/src/mock.ts`.

**Interfaces:** `ProjectBoard`/column/placement types from the design; owner actions `move_board_task` and `defer_task`. Both carry task ID, expected task/board revision; existing envelope carries operation ID and expected project revision. Moves also carry destination column ID and optional same-column `beforeTaskId`. Commands return validated canonical project/board state through existing receipts.

- [ ] Add pure `tests/contracts/board.test.ts` for bounds, duplicate IDs/orders, unknown/missing membership, duplicate Deferred, reserved identity and malformed board rejection. Check 0 and 40 tasks.
- [ ] Add offline `tests/cloud/board-commands.offline.test.ts` with injected transaction storage: replay once, changed-payload conflict, stale revisions, foreign IDs, one Deferred creation/reuse and owner placement override independent of task override.
- [ ] Run only those files and capture RED. Do not import the DB helpers or load `.env`.
- [ ] Implement the strict board schemas and pure command reducer. Canonical membership covers every task exactly once; deferral preserves status/evidence/due date and charges a single command operation.
- [ ] Add a rerunnable migration under the existing advisory-lock transaction: transform only legacy missing-board project JSON, persist generated IDs once, preserve all user records, and fail rather than repair corrupt current board data. Add pure migration fixtures/repeat-run tests; actual PostgreSQL proof remains held.
- [ ] Integrate through Store.command's existing credential, project lock, canonical hash/replay and revision checks. Preserve operation IDs after uncertain responses.
- [ ] Make fixture behavior match production and keep fixture inference unavailable. Update capability/schema probes and existing strict fixtures together; no silent mixed-version success.
- [ ] Run focused offline tests/typecheck, independent contract/security review, then publish the focused PR. Database migration acceptance is separately unrun.

## Task 3: Generate project-specific boards and apply scoped intent

**Files:** contracts `model.ts`/`api.ts`; `packages/nemotron/src/{runner,proposal-validation,tools}.ts`; cloud `jobs/queue.ts`, check-in scheduler/commands as needed, Store withdrawal and generated-dependency SQL. Coordinate with the paused `fix/nemotron-startup-shutdown` correction before touching overlapping model files.

**Interfaces:** model board proposals omit owner authority flags; server builds the canonical candidate. Optional message `taskContext` contains task ID/revision and board revision, scoped by the authenticated project. Persist that context with the owner message/job. A proposed owner action is not a committed action.

- [ ] Add focused pure/scripted tests for generated 1/4/12-column boards, new task membership, protected owner placement, reserved Deferred preservation, malformed proposals and stale grant/revision rejection.
- [ ] Add intent tests: exact `defer this task` with frozen valid context affects only that ID; no selected context, duplicate titles, stale revisions, negation/different phrasing and a delayed reply after selection changes cannot authorize a guessed move.
- [ ] Capture RED, then supply canonical board state and frozen task context to the existing bounded runner. Validate and commit tasks/board/reply atomically under the existing queue fences.
- [ ] For the exact unambiguous contextual deferral, reuse the typed owner action and originating authenticated message lineage. Other model-resolved wording yields a task-specific confirmation; revalidate on confirmation. Do not turn model prose into owner authority.
- [ ] Exclude Deferred membership from new next-action/check-in selection; consistently cancel/supersede unanswered affected questions while retaining answered history and attention reservations.
- [ ] Track generated column/placement dependencies. Test source revocation/expiry redacts dependent labels/placements without deleting owner Deferred placement or stable IDs, and fences in-flight proposals.
- [ ] Run only new offline/scripted files plus affected pure validator tests and typecheck. Independent security review is required. No model call or J2 retry.

## Task 4: Wire the sole Dice board and accessible project utilities

**Files:** `apps/web/src/app/{App,desktop-shell,snapshots}`; `features/board/TaskBoard.tsx`, board CSS; Chat context/composer; document/check-in presentation; focused UI tests. Lead owns shell/theme integration.

**Interface:** TaskBoard consumes canonical board columns/placements, validated tasks, current selection, disabled state and revisioned owner callbacks. It never derives final columns from task status. Invalid current board data retains a validated same-project prior board or displays unavailable/retry; never silently invent a status board.

- [ ] Add failing tests for canonical custom/Deferred columns, 0/1/6/16/40 tasks, arbitrary column order, long labels, empty columns, malformed board and no Overview tab.
- [ ] Add interaction regressions for pointer/keyboard drop, Escape/cancel, failed/uncertain command reconciliation, project A→B late result, concurrent model update and selected-task chat context.
- [ ] Replace the paused fallback board with Dice composition and real column data. Keep drag preview local; apply server-confirmed state only. Retain one recoverable operation envelope for an uncertain mutation.
- [ ] Keep one stable mounted notes/editor host and project-keyed composer. Project info, supporting updates and check-ins open accessible detail surfaces; focus returns safely when closed. Retain only documents belonging to the held arrangement while editing: do not mount a replacement editor before owner application.
- [ ] Add trusted manager icons to project entries; finish the integrated composer with no unsupported controls. Preserve all drafts, revision conflicts and late acknowledgment tests. Remove cancelled Overview JSX/CSS/tests instead of layering overrides.
- [ ] Use meaningful visual status/progress only from actual state. Board columns and cards fill the usable pane; document-level overflow is prohibited, deliberate column/board scrolling is allowed.
- [ ] Run scoped UI/contract tests excluding `tests/contracts/live-gates.test.ts`, typecheck, build, bounded artifact fixtures and output audit. Review pet CSS/asset isolation and packaged renderer CSP. Never run held live entry points.
- [ ] Perform one bounded browser interaction/capture batch at the five desktop sizes and enlarged-text reflow; fix the observed issues as one batch and confirm once. Record fixture/browser evidence separately from native behavior.
- [ ] Publish the focused candidate and share/open the actual sample-data preview promptly. **Wait for user visual approval before the next domain-control migration or UI integration merge.**

## Task 5: Joined board persistence acceptance when resources are released

**Files:** new `tests/integration/board-product.ts`, `docs/evidence/board-product.md`; update existing setup/demo documentation only after the new path is verified.

- [ ] Implement a bounded, test-owned harness with preflight isolation, finite deadlines and verified cleanup. It must exercise actual UI owner move/defer, canonical save, reload and restart, conflict recovery and source-withdrawal reconciliation.
- [ ] Keep ordinary unit tests and browser fixtures from promoting this gate.
- [ ] Run it only after explicit DB/native/resource release and independent harness review. This plan supplies no authorization to execute it now.
- [ ] After approval, rerun the final quiescent build/audit, record exact joined SHA/manifest and cleanup receipts; keep live Nemotron/T3/phone acceptance separate.

## Task 6: Mouse speech bubble in an independent pet leaf

Owned by the user's side-chat agents; do not start a competing pet worker here. Requirements below are integration criteria, not a new assignment.

**Files:** `apps/web/src/pet/Pet.tsx`, `pet-mouse.css`, pet-only rules in `styles.css`; new `tests/ui/pet-bubble.test.tsx`; isolated review harness. A minimal restricted native focusability command, if required, belongs to a separately reviewed contracts/preload/main patch, not a renderer window API.

- [ ] Write failing tests for mouse toggle, absent visible title line, bubble tail, entering/open/closing/closed state, Escape/focus return and closed controls excluded from focus.
- [ ] Add tests for animation-end and bounded timeout cleanup, rapid close/reopen, repeated presentation IDs, a new question during closing, unmount and OS/local reduced motion.
- [ ] Implement the design with the existing sprite. Keep closing content mounted until the transition ends; stale timers cannot close a newer presentation. Preserve restricted answer/snooze/preference commands and their revisions.
- [ ] Check the real 240×280 bounds. Put secondary actions/snooze behind understandable controls; use bounded scrolling for long text rather than clipping or shrinking. Do not use the larger review canvas as sizing proof.
- [ ] Inspect the existing focusable:false native seam; define/test a restricted explicit-user-gesture activation path before claiming native keyboard operation. No native launch under current holds.
- [ ] Run isolated pet tests and a clearly labeled sample-data preview of the actual Pet component. Independent code/visual review and user review precede merge. This task can run alongside the board after plan approval with disjoint ownership.

## Task 7: T3/Sendblue contracts and gated integration

Owned by the user's side-chat agents. Keep the researched capability/security gates for later integration; do not duplicate implementation or delay the board preview.

**Spec:** [T3 and Sendblue capability roadmap](2026-11-08-nemopal-t3-sendblue-roadmap.md).

- [ ] Freeze selected-thread grants, task/run mapping, activity/completion evidence and typed attention-request schemas before workers touch shared contracts.
- [ ] Implement selected-thread observation/activity and reliable completion rules first, with injected transports and offline replay/revocation tests. Do not conflate agent-reported success with verified task success.
- [ ] Implement Sendblue inbound/outbox through the existing canonical message/job pipeline in one end-to-end cloud leaf, disabled by default. Keep provided credentials private; offline work needs no credential read.
- [ ] Implement question-response correlation where T3 supports it. Permission-approval return remains blocked until a supported authenticated human-response API is verified; alerts/manual T3 resolution must be labeled accordingly.
- [ ] Fresh security review is mandatory before any real thread enrollment, export or phone action. No provider call, source read or deployment is implied by this plan.

## Task 8: Final review and integration order

- [ ] Review each immutable focused head, fix findings, confirm exact-head CI and preserve branch ancestry.
- [ ] Integrate foundation → canonical board → manager semantics → renderer in dependency order; integrate the pet leaf independently when its visual gate passes.
- [ ] Keep T3/phone behind their own flags/capability and real acceptance gates. No test suite converts unsupported approval transport into success.
- [ ] Report actual fixture/offline/browser/native/live/hosted results separately. No main/release deployment or blanket acceptance promotion.

## Self-review outcome

The plan covers the chosen Dice source, sole board, dynamic custom columns/tasks, explicit deferral, status/placement separation, retained notes/evidence/check-ins, sidebar/composer feedback, safe pet animation, T3 task activity and Sendblue relay requirements. It intentionally gates permission-approval return on a currently missing supported API. No implementation or live acceptance is claimed by this document.
