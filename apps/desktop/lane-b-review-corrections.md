# Lane B review corrections

## RESULT

In progress. Four findings from independent review of PR #5 at `69041e63baf25f413dc7b17e2ed7ad923dfe771c`.

Correction branch: `fix/desktop-review-boundaries`, created from Lead integration `1f337fb8b5c1273dc7fe02d0612238e1a29b5c10`. Correction PR base is `feat/integration-preflight` (PR #8), not main or PR #5. Existing producer/schema/App/launcher corrections are preserved. No children, real source reads, real exports, model calls, resources, browser work or VM operations.

## CHANGED FILES

Pending final inventory. Only desktop/observer/fixtures/desktop tests.

## CONTRACT IMPACT

No shared DTO/signature changes. Local journal migration will fail closed for missing receiving-consent identity.

## TEST COMMANDS AND OUTPUTS

- Finding 1: real main IPC harness with synthetic OS/network ports, real journal/vault/boundary/controller/sync/presentation. Empty cloud authority after offline restart: pause and revoke both failed before the fix. Expired cloud credential also reproduced the withdrawal failure. After device-custody authorization, all 3 tests pass, general cloud snapshot authority remains denied, foreign-device withdrawal remains denied.
- Finding 2: six expected RED failures across main restart/export-current-gate suites. GREEN: 7/7 focused tests. Restored queued excerpts are held for missing/changed endpoint or disclosure; legacy journals without acknowledged identity open but cannot export; matching acknowledged configuration retains the existing consented path; revocation attempts still reach the cloud port. Mid-drain identity change sends only the first permitted batch and retains the second. No actual OFF-state leak is asserted; all upload ports are synthetic.
- Finding 3: 5/5 RED terminal-turn regressions reproduced failed/interrupted anchors trapping later completed evidence and an unknown terminal item status silently waiting. Known failed/interrupted terminal boundaries now retain timestamp-proven completed messages and terminal command exit metadata, exclude unfinished terminal messages with explicit coverage, and advance within the 20-observation batch bound. In-progress work still waits; unknown statuses fail closed without returning a cursor.

Journal migration: additive optional `entries[].receivingConsent` with grant revision and the acknowledged API origin, receiving-model endpoint and disclosure. Optional parsing preserves legacy checksums; absence fails closed for uploads, without blocking revocation. Only native explicit confirmation supplies this metadata. No shared DTO is changed or sent to cloud. Each upload rechecks the current identity; changed receivers require explicit revoke/relink consent, never inference from stored export policy.

## LIVE EVIDENCE

Pending one controlled Windows native smoke after all real corrections. No live source/export/provider tests are authorized or run.

## BLOCKERS

Existing live observation, disclosed receiving endpoint and complete product acceptance gates remain unavailable. VM remains untouched/stopped.

## COMMIT

Pending.
