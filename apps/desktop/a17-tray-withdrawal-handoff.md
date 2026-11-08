# A17 native tray withdrawal handoff

## RESULT

Pause all local sources and Revoke all local source access are reachable from the trusted tray without a cloud origin, valid cloud token, project authority, or mounted SourceControls. Native confirmation explains local/queued/cloud effects and defaults to Cancel. Both actions share a busy guard; existing Open/Hide/Focus/click-through/Quit behavior remains.

Only bindings matching `vault.localDeviceId()` are withdrawn. Unknown custody changes nothing; custody is checked again after confirmation. Existing SourceController/JournalStore fence reads and exports, abort active observation, stop the observer, persist pause/revoke and pending cloud commands, and purge queued exports on revoke. Completion waits for the journal flush. Native result/error dialogs work independently of the renderer; errors disclose no raw exception/source data and do not claim cloud acknowledgement.

## CHANGEDFILES

- `apps/desktop/src/main/tray.ts`: two menu callbacks, shared busy state and guarded rebuild after Quit.
- `apps/desktop/src/main/index.ts`: trusted device-scoped withdrawal, confirmation, durable completion, sanitized native feedback.
- `tests/desktop/main-harness.ts`: real tray module; synthetic Electron menu/dialog/window/network/observer ports.
- `tests/desktop/main-tray-withdrawal.test.ts`: 19 callback-path regressions using real main/vault/controller/store/sync and temporary journals.
- `tests/desktop/native-smoke-app.ts`: required internal tray callback supplied as a synthetic no-op; no new native acceptance claim.
- This handoff.

## CONTRACTIMPACT

No IPC, DTO, credential, journal, dependency, React, cloud, or deployment contract changes. Only the internal tray factory options gain a withdrawal callback and action-aware error reporting. Controller/store authority and persistence code are reused unchanged.

## REDGREEN

- RED: all 15 initial tests failed before implementation because the native menu entries were absent. Cleanup was corrected before the recorded final RED run.
- GREEN: final focused file 19/19; desktop suite `pnpm test:desktop` 71/71 across 23 files; repository `pnpm test` 217/217 across 47 files.
- `pnpm typecheck`: PASS after correcting a test dialog mock signature.
- Desktop main/preload bundle: PASS via `node --import tsx --input-type=module -e "const { buildDesktop } = await import('./scripts/build.ts'); await buildDesktop();"`.
- Native smoke fixture bundle only: PASS via esbuild; no Electron launch. `git diff --check`: PASS.
- Cases include valid/expired stored credentials with offline cloud and no snapshot, missing origin, unknown/foreign custody, cancellation, re-pairing during confirmation, duplicate callbacks/menu rebuilds, Quit, late observation fencing, observer failure/retry, and real journal-write failure without a durable-success claim.

## LIVEEVIDENCE

Synthetic harness evidence only: production menu callbacks and main orchestration executed against synthetic OS/network/observer ports and real temporary journal files. Journal reopen proves durable local state/pending commands; it is not an actual product restart or physical/native menu interaction.

No native Electron process, product/menu pointer acceptance, actual source/provider/GPU/model calls, cloud deployment, DB operations, browser previews, or paid calls. J1 exclusively owns DB/native product acceptance; coordinate with the parent before launching any native process. The existing native smoke does not prove this product withdrawal path.

## BLOCKERS

No focused implementation/test blocker. Actual native product A17 acceptance and independent parent review remain pending; synthetic GREEN does not release those gates. Local persistence failures remain fenced in the running process and are visibly reported; a failed save must not be treated as durable protection after restart.

## COMMIT

Implementation: `082f3f10c34a17e122131709058c8a686975d0b9`. This handoff is a follow-up commit in the same focused PR. Prepared parent: `5f40d39eb21951b0eaf4df04333d380dc2f5e96a`; PR8 target: `f837d996db4f21e719eee5762fae2b11bb98f21d` (`feat/integration-preflight`). Their trees match `a6ecb73bcb55c1d4671577a13209cc8c416329a6`, and the prepared base is an ancestor of the target; no source merge/rebase was performed. Stack: PR5 -> PR8 -> this PR (PR10 already merged into PR8). Parent owns review/integration and recoverable archival after receiving the result; no subagents were created and this thread was not archived.
