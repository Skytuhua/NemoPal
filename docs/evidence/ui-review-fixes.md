# Workspace review corrections

Baseline: PR #2, `aa610f9cf7fd789faad2f51bce6796535ad4b884`. This correction is stacked on `t3/living-playbooks-ui-baseline`; it does not include the separate foundation corrections from PR #3.

The independent baseline review reproduced one critical and three important defects. The correction keeps the existing components, six-panel catalog, draft storage interface, and public contract shapes.

| Reported defect | Correction | Regression evidence |
| --- | --- | --- |
| Late document or chat acknowledgment deletes a newer draft after A → B → A | Draft mutations and acknowledgments are fenced to the active hook lifetime | Delayed document success, delayed document conflict, and delayed chat acknowledgment retain newer text in storage and after remount |
| A structural snapshot removes the focused document before owner application | Hold the displayed document records with the accepted layout, disable writes to a removed canonical document, and flush drafts before applying a replacement | The focused textarea stays connected with its local text until Apply; the replacement appears only afterward and the old draft remains stored |
| Retrying project creation after a lost response creates another project | Persist and flush the validated command before sending, then replay its original operation ID and input until reconciled | A committed request whose response is lost survives remount, replays the same operation ID, and creates exactly one project |
| Task links fail without a corresponding checklist row | Reveal the canonical task using the existing checklist component and focus its row | Question, next-action, and milestone links work with no checklist and with a checklist omitting the task; status updates persist |

The initial eight regression cases failed on the baseline. After the correction, all eight passed; three additional missing-checklist variants also pass. These eleven tests live in `tests/ui/review-regressions.test.tsx`.

Parent verification on 2026-11-07:

- `pnpm test`: 19 files, 80 tests passed (43 foundation, 26 original UI, 11 review regressions).
- `pnpm typecheck`: passed.
- `pnpm exec vite build --config apps/web/vite.config.ts`: passed.
- `pnpm evidence:check`: passed; 36 acceptance cases remain unexecuted in that ledger.
- `git diff --check`: passed.
- Impeccable detector on both changed production files: `[]` findings. This is a static heuristic, not visual or accessibility acceptance.

A separate read-only code reviewer inspected the correction diff and eleven regression tests and reported no critical or important findings. That reviewer did not rerun the suite or claim native/browser acceptance.

The regression suite uses synthetic fixtures and jsdom with an in-memory draft adapter. The original lane's bounded browser/IndexedDB checks are separate baseline evidence; they were not rerun for this correction. Native Electron/tray behavior, live backend and observer integration, actual IndexedDB races, and live Nemotron acceptance remain unverified here. The correction adds no dependencies, migrations, or cloud/model calls.
