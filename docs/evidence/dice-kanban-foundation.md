# Dice Kanban interface foundation

The original author receipts below describe `2aad4be75a0f397763c92a46bde2b20daa2ceeb9`. The parent correction receipts at the end supersede the adapted-source hash and consumer behavior where stated. This primitive has not yet been composed into the product board.

## Checkout and ownership receipt

- Prepared checkout only: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-6a9469b3`.
- Branch before edits: `t3/6a9469b3`.
- Exact initial HEAD: `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`, matching the requested shell checkpoint and PR40 head.
- Initial `git status --short`: empty. No other checkout was edited; paused parent App/board/chat/test changes were not copied.
- Exclusive files: `packages/project-ui/src/ui/{kanban.tsx,LICENSE.diceui.md,diceui-provenance.json}`, `packages/project-ui/src/index.ts`, `packages/project-ui/package.json`, `pnpm-lock.yaml`, `tests/ui/dice-kanban.test.tsx`, this document.
- Read-only context: parent's `2026-11-08-nemopal-dice-board-{implementation-plan,design}.md` under `feat-master-plan-acceptance-prep/docs/superpowers/plans`.

## Source custody

Actual [Dice UI Radix Kanban source](https://github.com/sadmann7/diceui/blob/048cdea5d20bb8b677690bfd47be8bd772e7781f/docs/registry/bases/radix/ui/kanban.tsx), revision `048cdea5d20bb8b677690bfd47be8bd772e7781f`, was fetched through the official GitHub API before copying. The contents API confirmed revision/path/blob/size; the blob API supplied base64 bytes, locally decoded and hashed:

| Receipt | Value |
|---|---|
| Upstream bytes | 32,344 |
| Upstream Git blob | `a03016bac0deefda600a1c1493f4f15c49e770da` |
| Upstream SHA-256 | `b5d8d177f47510ccf31ab5b42c7e39890f2769e31f10660fd3e321f0aeb8f96e` |
| Adapted bytes | 35,476 |
| Adapted SHA-256 | `9621d0ae8831f3a41986d3c803fb10dc6a76d71f7b43ef3f1e3f885f690170b2` |
| Verbatim MIT license Git blob | `6a059f7e2465f9b3f7d5e85f21a7ca7e8e449894` |
| License bytes / SHA-256 | 1,068 / `798456e9f649d796bad55d80f9ee50a71eb2d16920300a66a8221b70123e40db` |

`LICENSE.diceui.md` retains Copyright (c) 2024 Sadman Sakib and the complete MIT terms. `diceui-provenance.json` records API endpoints, hashes and modifications. No Kan/AGPL code or Next.js/documentation application was copied. Initial unauthenticated page/contents requests timed out or returned 502/504; the subsequent `gh api` contents and blob requests succeeded and supplied the verified receipts above.

Existing React 19.3.1, radix-ui 1.8.1, Tailwind 4, shadcn and Geist remain. New direct dependencies are exact pins: `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, `@radix-ui/react-compose-refs@1.1.2`. Imports use local `cn` and public compose-refs. No modifiers are imported or installed. Every install used `--ignore-scripts` in this checkout.

## Controlled interface and bounded fixes

The exported API is `Kanban`, `KanbanBoard`, `KanbanColumn`, `KanbanColumnHandle`, `KanbanItem`, `KanbanItemHandle`, `KanbanOverlay`, and `KanbanProps`. `value` remains a record of arbitrary stable column IDs to item arrays; `getItemValue` supplies stable task identity. There is no fixed status enumeration. IDs must be unique across columns and items within a board, as required by dnd-kit. Source `cn-kanban-*` hooks remain; the consumer supplies board/card layout classes.

`onValueChange` emits local drag previews. To accept a preview, pass that same record back as the controlled value (for example, `onValueChange={setDraft}`). An unrelated replacement object invalidates the pickup snapshot and hides the preview. Immutable clones returned by an external store are treated as external replacement, not as acknowledgment of the emitted preview. Parent composition must preserve this reference boundary or deliberately cancel/remount on project identity change. Mutating supplied records/arrays in place is outside the controlled contract.

Escape restores the exact pickup record only while the accepted emitted preview is still current. External replacements, removed tasks and removed columns are never overwritten by an old cancel/drop. Missing drop targets restore a current preview. Accepted preview ordering is not applied twice at drop. `onMove` fires once for a changed completed placement, with pickup `activeIndex` and final `overIndex`, including an empty destination; callback-only use can decline previews and handle the drop externally. The original dnd-kit event is retained: after a preview transfers a card, `event.over.id` may be that card's own stable ID in its destination. Consumers should use their pickup/current controlled records rather than assume `over.id` always names a column. Existing `onDragStart/Over/End/Cancel` forwarding remains.

Other bounded adaptations: own-property ID checks, keyboard candidate skipping, honoring item strategy, disabled-parent authority over child `disabled={false}`, and one-based empty-target announcements. Board click capture blocks card actions while dragging; the real upstream mouse sensor retains its post-drag click suppression.

The overlay portal gets a local `.workspace-ui` scope with `display: contents`, `inert`, `aria-hidden`, and `pointer-events: none`. Its cloned handles cannot become a second interaction surface. No global CSS/preflight or pet styles were introduced. There is no persistence, canonical schema, model authority, deferred-task semantics, App composition, texting or T3 integration here. Runtime mutations remain the parent's responsibility.

## RED/GREEN receipts

1. Before primitive/export creation, ran `pnpm exec vitest run tests/ui/dice-kanban.test.tsx --maxWorkers=1 --no-file-parallelism`: **9 failed**. The explicit API assertion failed `Kanban: expected undefined to be type of 'function'`; composition failed because the missing component was undefined. This is absent-primitive RED, not a browser interaction result.
2. After copying verified source with only import adaptations, the expanded focused file ran **6 failed / 6 passed**: empty-column `onMove` was missing, Escape resurrected a removed destination/task, disabled handles could override a disabled parent, `constructor` item identity crashed, and the portal lacked workspace scope. The reorder announcement failure in this intermediate run was traced to synthetic geometry, not counted as upstream proof: dnd-kit measures the overlay's single child, so its test rectangle must match the fixed wrapper. Tests now model that geometry explicitly.
3. Added callback-only empty-target announcement regression before its fix: **1 failed / 14 skipped**, expected `position 1 of 1`, received `item is now at position 0 of 0 in owner:waiting`. Fixed the one-based insertion position/total and reran GREEN.
4. Final focused file: **16 tests**, covering API/composition, arbitrary columns/duplicate titles/stable IDs, column keyboard sorting, item keyboard sorting, empty-column moves, callback-only moves/announcements, exact Escape rollback, frozen input immutability, replacement/removal fences, disabled parent/handle combinations, inherited-name task identity, avoiding double reorder, scoped inert overlay, card clicks during drag and real mouse-sensor post-drag click suppression.

All geometry and sensor dispatch in these tests is synthetic jsdom evidence. It does not prove physical pointer behavior, browser layout, OS focus or native Electron behavior.

## Validation

| Command | Personally run result |
|---|---|
| `pnpm exec vitest run tests/ui/dice-kanban.test.tsx --maxWorkers=1 --no-file-parallelism` | 16/16 GREEN |
| `pnpm exec vitest run tests/ui --maxWorkers=1 --no-file-parallelism` | Final source: 16 files / 157 tests PASS (75.27 s) |
| `pnpm typecheck` | PASS after final source changes |
| `pnpm build` | PASS after final source changes; Vite warns that the existing renderer chunk exceeds 500 kB |
| `pnpm exec tsx --test tests/build-output-audit.test.ts` | 64/64 PASS; synthetic artifact fixtures only |
| `pnpm exec tsx scripts/audit-build-output.ts` | PASS, 12 files / 6,673,838 bytes; `secretAbsenceProven: false` |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, lockfile up to date |
| `git diff --check` | PASS |

Bounded artifact manifest SHA-256: `537ed9dadb3bae503ffae9d07b4383ea93c2d61fe571639581ca7fb8fa5402b4`. Output Geist: 69,760 bytes, `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`. Output mouse: 960,766 bytes, `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`. Guard code and exceptions were unchanged.

Two user-requested parallel read-only agents advised on behavior and validation; neither edited files. The behavior agent reran the focused tests and found no blocking issues after the bounded fixes. That advisory review is separate from the parent's required fresh independent review. Native collaboration supplied no T3 task ID/child thread ID for the requested task-status/archive handshake, so completed native children remain visible; no self-archive or bulk cleanup occurred.

No full/cloud/DB/native/live suite, live entrypoint contract tests, provider calls, `.env`/secret reads, source enrollment, deployment, app launch or browser preview was run. The production command compiled the existing targets; it did not launch them. Parent integration and user visual approval are still required. Draft PR only; no watch or merge.


## Parent corrections after independent review

The exact-head independent review requested four P2 fixes. Parent reproduced them with eight new failing cases (the original 16 remained green), then corrected:

1. Offered and controlled-acknowledged preview records are distinct. Declining a later candidate no longer removes cancellation/drop authority over an earlier accepted preview. Escape offers the exact pickup record; the controlled consumer still decides whether to accept that rollback. Tests explicitly acknowledge rollback and cover both intercolumn and intracolumn cases.
2. Internal hover/drop notifications finish before forwarded consumer callbacks, on every return path. A consumer replacement in onDragEnd therefore has final authority. The same adjacent overwrite was reproduced separately for onDragOver (one RED) and corrected with the same ordering rule. onDragCancel already forwards after rollback.
3. Item/column handles and asHandle roots compose consumer handlers with sensors. A slotted child executes through Radix composition; consumer handlers run before the sensor and preventDefault blocks activation. Keyboard and secondary-mouse callback tests cover separate, asChild and asHandle paths, plus real sensor activation once.
4. Nullable IDs use explicit checks. Numeric zero retains overlay content/variant, collision and announcement handling; record column keys are normalized to strings. Numeric-zero item/column pickup and cancellation are covered.

Focused GREEN: 25/25 tests. The complete UI run in this isolated foundation checkout passed 166 tests across 16 files (81.63 seconds). Typecheck and whitespace checks pass. The tests use real dnd-kit sensors with synthetic jsdom geometry; they do not establish browser/native or visual acceptance.

Current adapted source: 38,122 bytes; SHA-256 `5544981a66505e03e9fc608d7e9a6bc1bdcd6309766846bcf1cc60a1fb6e58b4`. The upstream and license bytes are unchanged; provenance records the current adapted digest and all corrections.

Parent production build and 64 artifact fixtures pass. The bounded output audit remains 12 files / 6,673,838 bytes, manifest `537ed9dadb3bae503ffae9d07b4383ea93c2d61fe571639581ca7fb8fa5402b4`, secretAbsenceProven false. Its unchanged output is expected: the unused Kanban export is tree-shaken from the current product renderer. This is not a composed Dice UI board or browser interaction proof.

Parent changes are limited to primitive, focused tests, provenance and this evidence record in the completed author's isolated checkout. No coordinator/held-root/source/model/DB/native/phone/T3/deployment resource was changed. Fresh correction review and user visual approval remain required; no acceptance gate is promoted here.
