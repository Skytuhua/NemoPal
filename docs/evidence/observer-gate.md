# T05/T10 observer gate: synthetic verification, live acceptance pending

Base: [root PR15](https://github.com/Skytuhua/NemoPlaybook/pull/15), `feat/golden-workflow-integration` at `f1718a9f1698a32181b594f83b82360f59645f16`. Related boundaries: [PR8](https://github.com/Skytuhua/NemoPlaybook/pull/8), [PR5](https://github.com/Skytuhua/NemoPlaybook/pull/5). The approved master plan is unchanged.

## Result and scope

The acceptance runner now enrolls the selected tail, then polls with a bounded deadline for two distinct completed source-item identities. It no longer performs three immediate reads and mistakes nonempty batches for distinct updates. Only `tests/live/observer.ts`, `tests/desktop/observer-live-gate.test.ts`, and this document change. No extra helper, dependency, root script, contract, or production edit is needed.

**Partial status:** deterministic synthetic guard verification passed. No installed Codex process, actual source read, database, model/provider call, native GUI, or secret access was performed in this lane. The parent J2 automatic approval block was not bypassed. Neither T05 real-source acceptance, T10 full integration, nor J3 source-to-manager acceptance is established here. No review child, watch, merge, or self-archive was started; parent acknowledgement and recoverable task archival remain parent-owned.

## Existing implementation and contracts

- `CodexObserver` exposes only `probe`, `readDelta`, and `stop`. The runner reuses the existing exported installed factory, pinned `ADAPTER`/`VERSION` (`codex-app-server` / `0.166.0`), cursor decoder/hash, and shared binding/batch/capability schemas.
- `AppServerObserver.readDelta(binding, null, signal)` enrolls the current tail with no observations. Its baseline cursor fingerprints item identities/types so completing already-present baseline items does not backfill them. Later cursors validate source birth, prefix continuity, bounded full-history pages, and selected thread/cwd identity. The latest-20-turn window can block on a gap. In-progress work waits; supported completed visible messages and terminal command metadata retain their evidence levels.
- `SourceController` aborts/fences on pause/revoke/stop and submits batches to `JournalStore`. `JournalStore.commitObservationBatch` checks the expected cursor, current binding/grant, and export policy before atomically saving cursor and queued records. `off` prevents upload. The test runner intentionally does not instantiate the journal/controller or claim their durable ingestion path; it consumes normalized deltas in memory only.
- The production read transport's allowlist remains the authority for `initialize`, `initialized`, `thread/read(includeTurns:false)`, and `thread/turns/list(full,desc,limit20)`. No discovery/list/archive/profile scan or harness start/resume/inject/interrupt/approval/tool mutation is added. App Server initialization can write its own logs/state; filesystem purity is not claimed.

## Gate behavior

Before creating the observer, require exact `LP_LIVE_TEST_OPT_IN=1`, exact `LP_OBSERVER_LOCAL_READ_CONSENT=1`, a nonblank bounded `LP_SYNTHETIC_SOURCE_NAME`, and an explicit UUID `LP_SELECTED_SOURCE` equal to `CODEX_THREAD_ID`. The name is the caller's harmless-source assertion, never a title lookup or discovery permission. `sourceIdentity` remains the current project directory, which the existing adapter validates locally; it is never included in a receipt. Export stays `off` throughout.

`LP_OBSERVER_WAIT_MS` defaults to 120000, accepts integers 1000 through 300000, and includes probe, enrollment, sleeps, and reads. `LP_OBSERVER_POLL_MS` defaults to 1000, accepts integers 100 through 5000, and must be less than the wait. Invalid settings block before observer creation. Stop has a separate fixed 2000 ms grace. The gate bounds non-cooperative promises and discards their late results. It aborts the read signal before calling stop, removes signal listeners, and cancels its timers. Stop rejection/timeout blocks even if two items arrived. A timed-out stop cannot certify process termination; actual installed-process cleanup still needs live verification.

Only a valid empty enrolled baseline is accepted. The runner emits a safe `enrolled` event, then waits before each poll. Each candidate must have the enrolled binding/grant, pinned provenance, no excerpt, an unseen source-item identity, an unseen advancing cursor, and a completion timestamp strictly after enrollment and no later than detection. Changed observation UUIDs/revisions do not turn one source item into two; repeated or older cursors cannot rewind the accepted cursor. Old/future-dated items and activity markers do not count. Two distinct items can arrive together or in separate polls; two nonempty batches are not required. Coarse timestamps or clock skew may conservatively leave the gate blocked, so source work must complete clearly after enrollment.

Any probe/schema incompatibility or read failure blocks without retry, re-enrollment, broader discovery, or fabricated progress. Deadline expiry without two qualifying identities reports `no_two_fresh_items`; cancellation reports `cancelled`. SIGINT/SIGTERM use the same cancellation path in the CLI.

Receipts contain only fixed status/adapter/export metadata, counts, SHA-256 hashes of source identities/revisions, preserved item kind/evidence level, elapsed enrollment/detection timing, detection latency from the source completion timestamp, and cleanup status. They omit source text, raw item/thread IDs, source names, paths, cursor payloads, error details, and credentials. The deterministic seam explicitly emits `evidence: synthetic_guard` and `liveAcceptance: false`, including on a guard pass. The installed CLI requires `observed` provenance; fixture/import data cannot satisfy its live gate.

## Verification on 2026-11-07

Dependencies were absent in this isolated checkout. `pnpm install --frozen-lockfile --ignore-scripts` reused the pinned packages without tracked dependency changes or lifecycle execution.

RED: the first characterization test against the unchanged original runner expected one enrollment read before future work; it received four immediate reads. Original runner SHA-256: `3F1E796625020710A183C19E8478317844C12F3681EC547DE4F352FA206ECD3A`. Initial RED test SHA-256: `2B785918953139E8AA51EDDEC9AADB02E5709F2FFCE11067AC795D3F49F494DA`.

After exposing the injectable seam while retaining the old immediate-loop behavior, 30 of the initial 33 guard cases failed. Cases covered replay/no-fresh data, consent/config, cancellation, unavailable/transient reads, bounded waits/stop, provenance/identity, and receipt privacy. A separate regression challenge disabled only the identity-dedup branch: `pnpm exec vitest run tests/desktop/observer-live-gate.test.ts -t 'deduplicates source identities'` failed because duplicate items prematurely stopped the gate. Exact source bytes were restored before GREEN verification.

GREEN commands:

```text
pnpm exec vitest run tests/desktop/observer-live-gate.test.ts tests/desktop/live-observer-gate.test.ts tests/desktop/observer-readonly.test.ts tests/desktop/observer-cursor.test.ts tests/desktop/observer-terminal-turns.test.ts tests/desktop/observer-privacy.test.ts tests/desktop/observer-installation.test.ts tests/desktop/spool.test.ts tests/desktop/revoke.test.ts tests/desktop/reconnect.test.ts
pnpm typecheck
git diff --check
```

Result: **10 files / 63 tests passed**, including 42 new synthetic gate cases and the existing pre-consent CLI guard. The gate cases use a mocked observer and fake clock; one observes two externally supplied synthetic items at 18 and 38 simulated seconds. No wall-clock sleep or installed-source access is involved. Typecheck and whitespace validation passed. No full suite, database suite, native acceptance, production build, or hosted-CI acceptance was run or inferred. Review is self-review only, honoring the no-children boundary; independent parent review remains open.

Exact SHA-256 byte receipts for this implementation:

| File | SHA-256 |
| --- | --- |
| `tests/live/observer.ts` | `C1700B618AC629EA6FC51779D398BF2A215E60C498759B1A679ABFC317C4F557` |
| `tests/desktop/observer-live-gate.test.ts` | `447856AA5281C0458AFBE920F8C50332C7A27AB4B5F4FB6E60DD4EC15A60E4EB` |
| unchanged `living-playbooks-master-plan.md` | `B754FDEED280311545F354496E3FA3BE407B7254A6A3DBD758F06778DD94E5F0` |

`git diff --name-only f1718a9f1698a32181b594f83b82360f59645f16 -- packages apps scripts package.json pnpm-lock.yaml living-playbooks-master-plan.md` returned no changes.

## Remaining real-source requirements: parent-controlled, not executed here

1. Separately authorize local-content access to the exact own named harmless thread and confirm its current directory and existing installed 0.166.0 adapter compatibility. Set the gate's explicit consent/identity variables without printing their values; export remains off. Do not substitute an unrelated thread, archive, profile scan, upgraded adapter, or fixture.
2. Run the existing `pnpm test:live:observer` entry only under that authorization. After its safe `enrolled` event, the caller performs ordinary authorized source work elsewhere that independently persists two distinct completed permitted items before the configured deadline. The observer never creates the work or starts/resumes/injects/interrupts/approves a harness turn/tool. No manager/model launch is authorized by this document.
3. Retain the safe installed-source receipt with both distinct item hashes, actual source/detection timing, observed provenance, pinned adapter version, and confirmed stop. Independently verify installed-process noninterference and cleanup. Unsupported versions, source/schema gaps, no two items, and failed cleanup remain blocked.
4. Separately complete the authorized real delta -> durable journal -> ingest -> manager interpretation -> evidence-card flow to establish J3, and the remaining native/model/persistence workflow for T10. This test-gate PR alone cannot establish either.

## Parent correction after independent review

The original PR28 head `48f32bc199722ec3db6acc3dd9c0ec55de1e48a7`
had three independently reproduced defects: injected observed-mode mocks could
self-select live evidence; an awaited result could win a deadline/timer race;
and a previously unseen lower same-turn cursor could rewind the next read.
The parent reproduced all three as assertion failures before editing the gate.
The hashes and 42-case results above describe that original implementation.

The public injected entry now always returns `synthetic_guard` and
`liveAcceptance: false`, ignoring attempted extra evidence properties. Only the
private CLI path selects the installed factory, real clock and live evidence.
Elapsed bounds use a monotonic clock; wall time is separate and used only for
source timestamps and detection latency. The exclusive deadline is rechecked
after awaited probe/baseline/poll reads, during acceptance and before success.
Cleanup has its own monotonic grace check. A separate cleanup-boundary regression
first failed, then passed; a forward wall-clock change does not consume the
elapsed allowance. Same-turn lower offsets and baseline re-entry after progress
leave the accepted anchor intact. Ordering between opaque different turn IDs
still relies on the pinned production adapter's sequential anchor validation;
this gate does not independently order arbitrary turn identifiers.

Parent verification: 48 gate cases; together with the existing consent CLI,
read-only, cursor, privacy and terminal-turn suites, **6 files / 63 tests PASS**.
`pnpm typecheck` and `git diff --check` PASS. These are mocked/synthetic checks;
no database, native GUI, installed Codex process, real source, model, provider or
J2 execution occurred. No root checkout or local J2 files/processes were changed.
Fresh correction review remains required before merging this fix into PR28.
