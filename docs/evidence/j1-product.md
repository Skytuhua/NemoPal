# J1 actual product acceptance

Source parent: `cb888ef78f9a0aaed9ddd8f016731cb4880ae063`.

The bounded test `tests/integration/j1-product.ts` launches the production cloud bundle and actual compiled Electron main, preloads and React renderer. It uses the dedicated local PostgreSQL database and a fresh synthetic owner. No fixture client, controlled HTML, source selection, model opt-in, export or reminder consent is enabled.

The launcher sets `appData` and `sessionData` beneath a unique temporary directory before dynamically importing the actual main module. Actual main derives `userData` there. Persistent pairing requires the real Windows safeStorage API; temporary pairing is never enabled. The pairing grant stays in memory and is entered through the trusted UI. Logs contain only sanitized stage names and boolean receipts, with no trace, screenshot, grant or credential output.

After explicit parent DB resource release, run from the checkout:

```powershell
pnpm build
node --env-file=C:/Users/user/Documents/NemoPlaybook/.env --import tsx tests/integration/j1-product.ts --db-released
pnpm typecheck
git diff --check
```

The flag acknowledges an actual exclusive resource release; it must not be used while another suite owns this DB. The script refuses any database except `127.0.0.1:55432/playbooks_test` as `playbooks`. It assumes the parent has migrated; running the migration here could update other owners' legacy defaults.

Assertions cover trusted UI pairing; UI project creation with title and brief rendered and persisted in PostgreSQL; a Phase change to building with an increased saved revision; renderer reload; full desktop process restart without re-pairing; blocked inference and disabled send; no source bindings, observations or check-ins; and reminders off. Empty panels/tasks are expected with inference off. Cleanup stops only owned child processes, deletes content/receipts/credentials by the exact synthetic owner and project IDs in dependency order, and removes only the checked unique temporary directory. No truncation or unrelated-owner deletion is used.

Actual Windows execution on 2026-11-08 UTC: **PASS**, exit 0, about 4.9 seconds for the successful command. The parent explicitly released the DB before any database/server/native work, and this lane released it back after the successful cleanup. A separate process/directory inventory then found no owned cloud/Electron processes or `lp-j1-product-*` directories remaining.

Sanitized receipt from the actual command:

```json
{"result":"PASS","stage":"complete","uniqueSyntheticOwner":true,"productionCloudReady":true,"actualMainProfileIsolated":true,"nativeProtectedStorageAvailable":true,"trustedUiPairing":true,"uiCreateMatchesSavedSnapshot":true,"uiOwnerChangeSaved":true,"rendererReloadReadsSavedState":true,"fullProcessRestartRestoresProtectedCredentialAndSavedState":true,"modelExportRemindersOff":true,"ownedProcessesStopped":true,"syntheticOwnerRemoved":true,"isolatedProfileRemoved":true}
```

`pnpm build`, `pnpm typecheck`, `pnpm evidence:check` and `git diff --check` passed. The ledger checker validated 36 cases with 0 marked passed; this focused file does not alter the root acceptance ledger. Running `node --import tsx tests/integration/j1-product.ts` without the resource-release flag returned BLOCKED with the expected exit 2 before connecting to the DB. Production build initially lacked `tsx` because this isolated checkout had no dependencies; `pnpm install --frozen-lockfile` restored them without manifest/lock changes. Electron resolved its installed dependency binary on the first native attempt.

Five earlier attempts failed on harness assumptions before the successful run: wrapped select label text, polling before the asynchronous owner write completed, looking up Playwright's process handle after close disposed it, and assuming a source-free profile had already written a journal. These were corrected only in the test. Every attempt removed its exact synthetic DB owner. The first two attempts had already stopped their processes but reported cleanup failure because the process lookup had been disposed; their checked test-owned directories were subsequently removed after confirming no owned processes remained. The final harness performed all cleanup in `finally` and all three cleanup receipts passed. No product implementation change or artificial RED result was used.

Tested script SHA-256: `2944c7cf617d83d9c80a22375b0db75ebe82a098f946fbd7c89edbccec882864`.

Parent separately reported its joined-source serial suite: 63 files / 264 tests passed. This lane did not rerun that DB suite.

This acceptance does not prove live inference, generated panels, source observation/export, reminders, hosted deployment, packaging or user visual approval. No artificial RED result is claimed for an existing product acceptance journey.

## Parent review corrections and independent native rerun

Independent review identified unbounded native evaluations and possible foreign-owner scheduler changes. Both profile and safeStorage evaluations now use the existing finite bound, extracted into j1-safety.ts. A read-only preflight runs before grant creation or cloud spawn and blocks on another active project's open check-in or excerpt; all foreign excerpts are conservatively blocked so they cannot expire during the journey. No existing owner is deleted or changed to satisfy the guard. A blocked preflight does not attempt synthetic-owner cleanup writes.

Four dedicated PostgreSQL/safety regressions pass, including unchanged foreign check-in/excerpt fixtures and a stalled evaluation reaching cleanup. Initial test setup reported the missing helper import; that is not claimed as behavioral RED. The independent review's original reproductions establish the two defects. Typecheck and diff checks pass, and a separate code-reviewer found no findings in the correction.

Parent independently reran the actual production Windows J1 command after the correction: PASS, exit 0, about 5.9 seconds. All original boolean receipts, actual safeStorage/pairing/save/reload/full-restart and owned process/owner/profile cleanup passed. Model, source, export and reminders stayed off. No further DB/native instances remain from this run. This native rerun covers the corrected harness; J2-J5 remain outside it.

Parent-tested script SHA-256: 70d177d04599f198cc23a93f9412a4bf549acd167059332800075f3ef60b13e4
Parent-tested safety helper SHA-256: 087ae98bfaf3be468f1b407c8e73d0dfb7c49aba79214530461caba5a23f99e1
