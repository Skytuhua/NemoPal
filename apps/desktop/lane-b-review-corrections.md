# Lane B review corrections

## RESULT

All four reproduced findings corrected and verified. Parent fresh independent review is pending. This does not accept the still-blocked live/product gates.

Review input: full independent PR #5 report at `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-4d95f860/.superpowers/reviews/pr-5-69041e6-review.md`, reviewed SHA `69041e63baf25f413dc7b17e2ed7ad923dfe771c`. Read before edits with master-plan sections 9, 10, 11.1, T04/T05/T07/T09 and A11/A12/A15/A16/A17/A18/A19/A31.

Correction branch: `fix/desktop-review-boundaries`, created from Lead integration `1f337fb8b5c1273dc7fe02d0612238e1a29b5c10`. Correction PR base is `feat/integration-preflight` (PR #8), not main or PR #5. Existing producer/schema/App/launcher corrections are preserved. No children, real source reads, real exports, model calls, resources, browser work or VM operations.

Consumed supplied pairing main `5ae1bdc60eda41526de4839e5abef6b98181aa7e` by ordinary merge `41bce3f088c7cb9a1546fe06543f31c2d96d131d`. Its seven pairing UI/test/doc files are byte-identical to that main commit (`git diff --exit-code` passed); those inherited files can remain in the PR #8-relative diff until Lead advances its base. No App, pairing UI, PR #10 question inbox, contracts, manifests or dependency edits were authored by B. The old B5 open-project patch is historical: its producer is already applied in the consumed Lead commit and must not be reapplied.

## CHANGED FILES

Authored correction files:

- `apps/desktop/src/main/{index,credentials,consent,local-store,sync,presentation}.ts`
- `packages/codex-observer/src/{adapter,normalizer}.ts`
- `fixtures/codex/synthetic.ts`
- `tests/desktop/main-harness.ts`, `{main-local-withdrawal,main-restored-exports,export-current-gate,main-project-selection,observer-terminal-turns}.test.ts`
- Existing `tests/desktop/{consent,reconnect,sync-http}.test.ts` and this report.

## CONTRACT IMPACT

No shared DTO/signature changes. Local journal migration will fail closed for missing receiving-consent identity.

Local withdrawal uses the decrypted existing device identity, including an expired cloud credential, only to stop a matching durable local binding. Window/frame/origin/schema validation remains in the real main IPC boundary. It does not populate cloud project/record authority or authorize cloud reads/mutations. Fencing, observer stop and durable local state precede cloud reconciliation.

Native selection now stores the latest workspace request and generation before awaiting sync/network. Background refreshes cannot select; pin state is distinct from workspace selection. Presentation receives an immediate selection fence, so old project actions and pending old presentation results cannot regain authority while the latest request is pending.

## TEST COMMANDS AND OUTPUTS

- Finding 1: real main IPC harness with synthetic OS/network ports, real journal/vault/boundary/controller/sync/presentation. Empty cloud authority after offline restart: pause and revoke both failed before the fix. Expired cloud credential also reproduced the withdrawal failure. After device-custody authorization, all 3 tests pass, general cloud snapshot authority remains denied, foreign-device withdrawal remains denied.
- Finding 2: six expected RED failures across main restart/export-current-gate suites. GREEN: 7/7 focused tests. Restored queued excerpts are held for missing/changed endpoint or disclosure; legacy journals without acknowledged identity open but cannot export; matching acknowledged configuration retains the existing consented path; revocation attempts still reach the cloud port. Mid-drain identity change sends only the first permitted batch and retains the second. No actual OFF-state leak is asserted; all upload ports are synthetic.
- Finding 3: 5/5 RED terminal-turn regressions reproduced failed/interrupted anchors trapping later completed evidence and an unknown terminal item status silently waiting. Known failed/interrupted terminal boundaries now retain timestamp-proven completed messages and terminal command exit metadata, exclude unfinished terminal messages with explicit coverage, and advance within the 20-observation batch bound. In-progress work still waits; unknown statuses fail closed without returning a cursor.
- Finding 4: 4/4 RED real-main boundary regressions reproduced B/A response-order selection, acceptance of the old pet project while B was pending, late background A selection, and unpin reverting to stale A. GREEN: 4/4 selection tests plus 3/3 existing presentation tests. Workspace identity/generation is established before awaiting sync/network. Background reads capture a lease and never select; pet presentation/actions are fenced immediately. A separate pin retains effective A while workspace requests B; unpin restores the latest requested B.

Intermediate validation: the first terminal-turn test run was green but typecheck exposed an overly narrow synthetic page variable; its annotation was corrected without changing assertions or production behavior. Final verification below supersedes intermediate runs.

Final verification after real corrections and the supplied main merge:

```text
pnpm test
45 files passed; 194 tests passed; exit 0

pnpm typecheck
tsc --noEmit; exit 0

pnpm evidence:check
Acceptance ledger valid: 36 cases, 0 marked passed.
This checker does not execute or independently verify acceptance.

pnpm test:native
PASS — win32, Electron 45.2.3; controlled synthetic test HTML only.

git diff --check
exit 0
```

Focused verified runs: local withdrawal 3/3; receiver/current-gate/consent/replay HTTP suites 12/12; all observer suites 15/15; selection plus existing presentation 7/7. The final full suite includes all of them plus inherited contracts/UI/pairing tests. Native smoke ran once after the real changes. No extra browser or native product/pairing rounds were run.

Journal migration: additive optional `entries[].receivingConsent` with grant revision and the acknowledged API origin, receiving-model endpoint and disclosure. Optional parsing preserves legacy checksums; absence fails closed for uploads, without blocking revocation. Only native explicit confirmation supplies this metadata. No shared DTO is changed or sent to cloud. Each upload rechecks the current identity; changed receivers require explicit revoke/relink consent, never inference from stored export policy.

## LIVE EVIDENCE

One controlled Windows native smoke PASS on Electron 45.2.3: actual second-instance lock denial; separate sandbox preloads; no renderer Node/token; forbidden IPC denial; small topmost pet shown without focus; native tray callbacks/close-to-tray/click-through escape; work-area clamp; protected async encryption and restart decryption; stop then flush on Quit. Test HTML, credentials and source ports are synthetic. This does not demonstrate actual product pairing, physical tray pointer actions, physical display removal or a live model/source/question cycle. `ELECTRON_RUN_AS_NODE` is removed only from the spawned Electron child environment.

All review reproductions used the real application security/data components with synthetic OS/network/source ports and isolated temporary journals. No actual source histories, hidden reasoning, receiving endpoints, providers, Brev or VM resources were accessed.

## BLOCKERS

Existing live observation, disclosed receiving endpoint and complete product acceptance gates remain unavailable. VM remains untouched/stopped.

No new shared DTO or dependency is required for these fixes. Legacy queued grants without receiver identity are intentionally held, not auto-migrated into consent. A changed receiver/disclosure needs explicit source revoke/relink consent under the existing flow; revocations remain eligible to synchronize. The correction does not claim an excerpt leak from an actual export-OFF grant.

Parent owns fresh independent review and actual product/native/pairing J1 acceptance. No merge, force push, watch or child cleanup action is performed by this lane.

## COMMIT

`f2383b8` — local offline withdrawal; `b846e20` — acknowledged receiving identity; `58c2984` — terminal turns; `13b23d9` — selection generation/pin fencing (and synthetic type annotation correction). Implementation plus supplied-main merge head: `41bce3f088c7cb9a1546fe06543f31c2d96d131d`. Final report commit/PR head is returned in the delivery response. Parent acknowledges that result before completed/result_available/no-child verification and recoverable archival.
