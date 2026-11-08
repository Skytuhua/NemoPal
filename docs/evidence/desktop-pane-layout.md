# Desktop pane layout state handoff

This is author-run, synthetic renderer evidence for the layout-state leaf of
`docs/superpowers/plans/2026-11-08-shadcn-desktop-shell.md`. It grants no visual,
native, provider, hosted, production, or acceptance-ledger approval.

## Source custody and ownership

- Checkout: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-73992751`.
- Branch: `t3/desktop-pane-layout`; initial status clean.
- Initial HEAD/common source: `1bc49ade09499f46fe048546ad202a5e0ee1efc4`.
- Initial tree: `39c09174addb4ba631ca2b824e79409270905cad`.
- Parent target: `feat/shadcn-desktop-shell`, never integration/main.
- Integration reference: `f04fa8a03fb6a212388182fd29825843f3f23638`.
- Only three new files: `apps/web/src/app/useDesktopPaneLayout.ts`,
  `tests/ui/desktop-pane-layout.test.tsx`, and this handoff.
- No other checkout was used or modified. PR33 remains held; the interrupted
  checkout and held Documents checkout were not read or changed.

## Public seam and parent integration

`useDesktopPaneLayout()` exports the agreed `PaneWidths` and `Drawer` types and
returns `containerRef`, `narrow`, `drawer`, `preferredWidths`, `effectiveWidths`,
`openDrawer`, `closeDrawer`, `commitUserWidths`, and `resetLayout`.

1. Mount one hook in the persistent shell owner. Attach `containerRef` to the
   stable, full-width div containing the horizontal group. Use a container
   without border/padding/transforms so its initial rectangle and observed
   content width represent the same pane budget. Keep it mounted across modes.
2. Feed `effectiveWidths.projects` and `effectiveWidths.manager` as pixel widths
   into the official Resizable adapter. Projects bounds are 200..360, manager
   bounds 300..560; reserve 480 for Workspace and 16 for both handles on desktop.
   The right/chat pane maps to the `manager` width field.
3. Call `commitUserWidths({ projects, manager })` only after a known user pointer
   or keyboard resize. An automatic library layout callback is not user intent.
   Callback identity is stable; commits use the latest observed container width.
4. Below 1100 measured CSS pixels, keep Workspace visible and use `drawer` to
   select Projects or Chat. The hook owns exclusivity and clears on widening.
   Parent owns Sheet rendering, focus/inert/Escape/backdrop behavior, and keeping
   the actual editor/chat DOM and drafts mounted through viewport changes.
5. Wire Reset layout to `resetLayout()`. It restores and persists 240/360 even
   when narrow. Only explicit commits and reset write preferences.

Desktop fitting divides the room above the two sidebar minima in proportion to
each preferred width's excess over its minimum. Example: preferred 300/500 in a
1146 container fits to 250/400, leaving 480+16 for Workspace and handles. Automatic
shrink never changes the preferred pair or storage; widening restores the pair.

Ruling: in drawer mode, effective widths remain the bounded preferences; the
desktop budget is inactive. An explicit commit in narrow mode clamps per-pane
bounds and retains that intent for widening. Parent should only send real resize
commits. If this assumption changes, the narrow-mode adapter contract needs review.

The hook initially treats an unmeasured/zero-width container as narrow. It measures
in a layout effect, observes the actual container, filters invalid/unrelated
entries, and disconnects/ignores retired observer callbacks. Without
ResizeObserver it measures initially and on window resize, removing that listener
on unmount. Fallback container-only changes without a window resize are not
observed; no resize polyfill or second pointer implementation was introduced.

## Preferences and dependency provenance

- localStorage key: `lp:desktop-pane-layout:v1`; payload:
  `{"version":1,"projects":240,"manager":360}`.
- Missing/malformed/wrong-version/wrong-type/nonfinite records fall back to
  defaults without repair writes. Finite stale values clamp to bounds. Invalid
  commits leave state and storage alone; valid commits also fit the current
  desktop budget. Getter/getItem/setItem security failures and quota failures
  cannot escape into the app; in-memory layout and editing remain usable.
- Original leaf implementation using only the existing React hooks. No copied
  upstream implementation, optional foundation import, new package, configuration,
  lockfile edit, network/cookie/auth behavior, or document focus mutation.
- Node `v24.14.0`, pnpm `10.30.3`. Ran
  `pnpm install --offline --frozen-lockfile --ignore-scripts`: exit 0, 176 reused,
  zero downloaded. Existing Electron package metadata was resolved with scripts
  disabled; no native binary download/install/run or audit/autofix/upgrade.

## RED/GREEN and bounded verification

1. Wrote the 37 controlled React tests and an inert public-seam scaffold first.
   `pnpm exec vitest run tests/ui/desktop-pane-layout.test.tsx` exited 1:
   **20 failed, 17 passed**. Missing observation, preference loading/clamping,
   explicit commits, fitting, drawer state, cleanup, and fallback measurement
   produced behavioral assertion failures. The default/no-op scaffold did not
   count as implemented validation.
2. Implemented the hook. The same command exited 0: **37 passed**.
3. Regression sensitivity check: temporarily removed the storage-version/type
   gate and commit numeric gate in this owned module, then ran
   `pnpm exec vitest run tests/ui/desktop-pane-layout.test.tsx -t 'preference storage boundary|invalid user commit'`.
   Exit 1: **13 failed, 10 passed, 14 skipped**. Restored the exact source in a
   `finally` block, then reran the full focused file: exit 0, **37 passed**.
   No validation mutation is retained.
4. The first broader run overlapped that temporary mutation and is discarded as
   a receipt, regardless of its output. Repeated after restoration with source
   stable: `pnpm exec vitest run tests/ui tests/contracts --exclude tests/contracts/live-gates.test.ts`:
   exit 0, **24 files / 188 tests passed**. This includes the new 37 tests.
5. `pnpm typecheck`: exit 0 (`tsc --noEmit`). `git diff --check`: exit 0.
   Existing tracked files compared with the common source remained unchanged.
6. Impeccable mechanical detector on the hook: exit 0, `[]`. Used the skills'
   operational/responsive guidance; the approved black desktop brief takes
   precedence over old design context and generic landing-page suggestions.

Tests fake only storage and browser measurement boundaries. They exercise initial
container sizing independently of viewport width, exact 1100 transition,
proportional shrink/widen, fractional preferences, persistence only on user intent,
reset/reload, invalid/negative/huge/nonfinite values, unavailable storage, mutual
drawer exclusion, batched widen/shrink clearing, stable callbacks, observer
cleanup/late notifications, StrictMode retirement, and the missing-observer
fallback. A stable child textarea retains its node, text, and focus in the hook
harness; this does not establish the parent's future shell identity behavior.

Initial author review: no unresolved in-scope finding was identified. No reviewer child was
started because the assignment explicitly forbids children; the parent must
independently review this exact delivered revision. Declined to judge composition,
official library pointer/keyboard behavior, Sheet accessibility, visual quality,
actual Windows Electron behavior, and live/hosted/provider acceptance: those are
outside this leaf and have not been exercised here.

Not run: `tests/contracts/live-gates.test.ts` (invokes the model verification entry
point), full/cloud/DB suites or helpers, build/artifact audit, browser/app/dev
server, native GUI, live models/providers/sources/exports/reminders, VM or
deployment. No acceptance ledger changed. User visual approval remains required
for the first combined shell before phase-two controls or integration merge.

## Verified implementation bytes

SHA256 at initial publication `4f15d9b` (historical bytes, before the parent correction below):

- Hook: `c297c83e9c259dbb1dd1ea37b22b837c1c670e3e61ccd4ba0ab18aa36d121766`.
- Tests: `c19c9c38c58a3c26597bd3367a0011853d3de60fb3d73c672aeaacd82b20400d`.

The final delivery reports the immutable commit/tree, clean status, and publication
result. No watch, merge, branch deletion, self-archive, or child lifecycle action
is authorized for this implementation leaf; the parent owns review/integration
and archives only after receiving the result and confirming completed task state.

## Parent correction after independent review

The independent review at `4f15d9b` reproduced one P2: retained commit/reset
callbacks from an unmounted controller could overwrite a newer controller's
persisted widths, despite React discarding the retired state update. Observer
cleanup alone did not protect these external storage writes.

The parent added two regression cases which each retain a callback from A,
unmount A, commit B's newer widths, invoke the retired callback, then reload.
Both failed before the fix: the retired commit wrote 220/330 and the retired
reset wrote defaults over B's 320/480. A separate StrictMode case verifies that
the current controller can still commit and reset after effect cleanup rehearsal.
RED: 2 failed / 38 passed. A mounted-lifetime fence now retires both persistence
callbacks and reactivates on effect setup, preserving StrictMode behavior.

Parent verification after the correction:

- `pnpm exec vitest run tests/ui/desktop-pane-layout.test.tsx --maxWorkers=1 --no-file-parallelism`: **40/40 PASS**.
- `pnpm typecheck`: **PASS**.
- `git diff --check`: **PASS**.
- Hook SHA256: `11fcf68fae7f05a4a543dcbf54040439eb0c9a01554e1532c300f674702556ae`.
- Tests SHA256: `e8d2e7e63b54262ac428a49e7eae094b35dbcf32a4eeacd420eb70a4c8e9ff7a`.

Only the same three leaf files changed. The earlier 188-test receipt remains
historical; it was not rerun for this correction. Fresh independent recheck and
exact-head hosted CI remain pending. No browser/native/live operation or
acceptance promotion occurred.
