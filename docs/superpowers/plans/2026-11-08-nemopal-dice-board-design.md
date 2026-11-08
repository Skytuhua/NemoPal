# NemoPal Dice UI board design

Status: proposed design for user review. No implementation acceptance is implied.

Latest ownership: this coordinator owns **interface first**, including Dice UI foundation and board composition. The user reports pet, T3 and Sendblue work is active in side-chat agents. Do not duplicate or modify those lanes; coordinate their future integration seams.

## Product decisions

- Windows Electron, existing React/Vite renderer and backend. Product name: NemoPal.
- A project-specific task board is the **only** central workspace. The old Overview page and secondary tab are removed; its work is stopped.
- Preserve Projects on the left, manager/chat on the right, independent resizing, persisted widths, and Projects/Chat drawers below 1100 CSS pixels.
- Preserve the native workspace title bar, default 1240×820 and minimum 800×600.
- Black and neutral near-black surfaces, local Geist, readable section/card text, restrained status accents. No copied Trello background, fabricated metrics, model picker or Build button.
- A mouse belongs to the project manager: show trusted local manager art in each project entry and manager identity. It is not the application logo.
- Keep useful space occupied by actual task cards and project information. Do not stretch filler or invent graphs merely to fill a viewport.
- Notes, owner drafts, evidence, check-ins and settings remain reachable through board actions/detail surfaces. Removing Overview never deletes their records.

## Source to reuse

Use Dice UI's Radix Kanban primitives, not Kan's application or MCP server.

- Repository: https://github.com/sadmann7/diceui
- Revision: `048cdea5d20bb8b677690bfd47be8bd772e7781f`
- Source: `docs/registry/bases/radix/ui/kanban.tsx`
- Git blob: `a03016bac0deefda600a1c1493f4f15c49e770da`
- Size: 32,344 bytes; SHA-256: `b5d8d177f47510ccf31ab5b42c7e39890f2769e31f10660fd3e321f0aeb8f96e`.
- License: MIT. Retain the copyright/license and record every adaptation.

The primitive supplies column/card composition, pointer and keyboard sorting, overlays and accessibility hooks. It does not supply NemoPal persistence, model authority, T3 access or texting. Review its cancellation and controlled-state behavior before adoption. Avoid depending on an unpinned `radix-ui/internal` import; use the existing package's public composition primitive or a pinned public ref-composition utility.

## Canonical board

Persist `Project.board` independently from task status and the legacy panel array. Columns describe a project's workflow, not an enumeration of the five existing task statuses.

```ts
type BoardColumn = {
  id: string;
  title: string;
  kind: 'workflow' | 'deferred';
  origin: 'owner' | 'manager' | 'legacy';
};
type BoardPlacement = {
  taskId: string;
  columnId: string;
  order: number;
  ownerOverride: boolean;
};
type ProjectBoard = {
  schemaVersion: 1;
  id: string;
  revision: number;
  columns: BoardColumn[];
  placements: BoardPlacement[];
};
```

Bounds: 0–40 project tasks; 1–12 board columns; titles 1–120 characters; exactly one placement per task; placement order is a finite nonnegative integer. IDs and within-column order must be unique. Reject unknown references, duplicate membership and malformed current-version boards.

There may be at most one semantic Deferred column. The first deferral creates it atomically; later deferrals reuse its persisted identity. The model cannot remove/repurpose that column or move owner-placed tasks without a new owner action. Moving to Deferred changes membership only: no fabricated blocked/done state, due date, evidence or completion. Deferred tasks are excluded from suggested next work and new proactive check-ins; answered question history remains.

Legacy projects receive a one-time persisted board derived from their real tasks. Migration preserves task IDs, statuses, evidence, documents and owner corrections. A legacy status grouping is an import fallback, not evidence of model-generated columns. Missing legacy data is distinct from corrupt new board data; corruption fails closed.

## Nemotron and owner intent

Nemotron may propose bounded project-specific column titles/order, tasks and memberships using structured schemas. Commit the validated tasks, board and manager reply together through existing revision/epoch/lease/grant fences. Generated text is data; never render generated HTML or execute generated UI code.

Board placements have their own owner override. Reusing task.ownerOverride would incorrectly freeze unrelated task fields. Model proposals cannot write owner flags, fabricate owner evidence or claim task completion.

Chat can carry frozen selected-task context: task ID/revision, board revision and project identity. An explicit authenticated request `defer this task` with valid context can authorize that one typed owner action. Different or ambiguous wording produces a task-bound proposal/confirmation; no guessing from array order, duplicate titles or later selection. A model interpretation never grants itself owner authority. Retries preserve the originating operation/message identity.

Source-derived column labels and placements need dependency tracking/redaction. Withdrawal cancels stale generated proposals and removes withdrawn material while preserving stable identities and explicit owner placements.

## Board interactions

- Render canonical arbitrary columns and ordered task IDs directly into controlled Dice UI primitives.
- Dragging previews placement only. A drop submits one revisioned owner command. Confirmed server state becomes canonical; failure/conflict restores canonical placement and preserves a recoverable request identity when outcome is uncertain.
- Escape, project switching, revocation, missing targets and unmount cancel local dragging. Late replies for another project/session cannot alter the current board.
- Card titles open useful task details; status remains a separately labeled owner control. Keyboard movement has the same authority and persistence as pointer movement.
- Do not show a fake Add task/column control. Expose creation only when its actual revisioned command exists.
- The board occupies the available center height. Columns scroll vertically; the board can pan horizontally when all readable columns cannot fit. Neither operation creates document-level horizontal overflow.
- The composer is one integrated input/send surface. Preserve drafts, IME, disabled reasons and delayed acknowledgments; no model selector or Build button.
- Optional progress is calculated from actual task statuses; skipped is not done. No velocity/history graphs without corresponding source data.

## Pet speech bubble

Use the unchanged approved mouse sprite and actual Pet component. Remove the title/name line from the bubble, while retaining accessible manager identity. Make the container a speech bubble with a visible tail toward the mouse.

Clicking the mouse opens/closes the bubble. A new trusted question may open it once; repeated events cannot override a manual dismissal. Keep a closing phase mounted until animation completion, with a bounded fallback. New presentations cancel stale close callbacks. Restore focus to the mouse after closing; a closed bubble cannot receive keyboard focus.

Honor both OS and local reduced motion: no transition delay or movement. Fit the actual 240×280 native bounds, using compact primary answers and a secondary actions/snooze surface. Never clip a question or make necessary actions unreachable. The larger browser demonstration is not native sizing proof. The existing native window is `focusable:false`; keyboard activation needs a reviewed restricted user-gesture path before claiming native accessibility.

## T3 and Sendblue follow-up

Retain the requested selected-thread observation, task activity, reliable completion and human-approval relay as real product requirements. They are separate contracts/integration work, not a side effect of Dice UI or MCP installation. Detailed capability gates are in `2026-11-08-nemopal-t3-sendblue-roadmap.md`.

## Acceptance

First review a working Dice UI shell using clearly labeled synthetic data. User visual approval is required before migrating further controls or merging UI into integration. Tests alone do not approve appearance.

Verify 1240×820, 1366×768, 1440×900, 2000×1050 and 800×600, plus enlarged-text/reflow cases. Cover 0/1/6/16/40 tasks, empty/custom/Deferred columns, 1/4/12 columns, long labels, pending saves and switching projects. Ordinary six-task desktop content must not need main-page vertical scrolling. Large projects use deliberate pane scrolling rather than unreadable text.

Native, database, provider, phone, source export, VM and deployment gates remain held. Do not retry the earlier policy-blocked J2 test by any route.
