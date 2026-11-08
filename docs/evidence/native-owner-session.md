# Native pairing session authority

T11 F3 allowed an old-owner snapshot to return over IPC, repopulate native
authority and reach the pet after a different device had paired successfully.
The implementation boundary is the actual desktop main entry point; public
contracts, cloud code, API client implementation and web UI are unchanged.

## Behavior

Each authenticated native client captures its credential, owner generation and
abort signal. Hashing or authorization lookup cannot make an old operation
acquire the replacement credential. Owner-bearing reads and mutations check the
generation after awaits and before remembering state, presenting it or returning
over IPC. Old event streams and polling continuations cannot change the new
owner's sequence, authority or connectivity.

After a valid redemption, pairing invalidates the previous session before
awaiting protected storage. It clears volatile authority, selection, pin and
cached pet identity, stops previous observation/synchronization, and persists a
cleared project pin while preserving ordinary pet preferences. Pending answers
on the old presentation cannot schedule a refresh using the new owner.

Pairing is serialized. Each redemption attempt has its own cancellation
controller, canceled by Quit; authenticated clients from the previous session
remain canceled. Quit waits for an already-running protected pairing write.
Late replies from an earlier pairing are rejected if another pairing has since
advanced the session. If replacement fails after invalidation, cloud operations
stay blocked while local source custody remains available for withdrawal and
explicit pairing retry.

Prior-device bindings, observations, cursors and withdrawal commands remain in
the journal. Native synchronization filters by the paired device before taking
bounded batches, so retained prior-device work neither leaves under the new
credential nor blocks the new device's queue. Only the current device's local
bindings join its snapshots. The one-selected-source check applies per device;
the existing bounded journal still retains older device custody.

## Executed evidence

The tests use the real main entry point, boundary, HTTP client, vault, journal,
sync, source controller and presentation with synthetic Electron, protected
storage, observer and fetch ports. They create only test-owned temporary
profiles; a recording fetch stub supplies all HTTP responses.

- Four initial RED cases reproduced stale snapshot/list authority, an old event
  stream surviving pairing, and an old project pin surviving pairing.
- Two additional RED cases reproduced transport invocation after Quit during
  the storage check, and an earlier pairing reply returning after a later pair.
- Independent code review identified a HIGH recovery regression: a failed
  protected save left the next redemption using an aborted owner signal. A
  recording fetch that honors aborted signals reproduced that failed retry.
  Fresh redemption controllers correct it while old local withdrawal remains
  usable. Review rechecks are tracked on the PR.
- Final parent execution: **172 desktop tests in 28 files PASS**, including
  **16 new owner-session cases in two files**. Typecheck, the desktop main
  bundle and whitespace validation pass.

```powershell
pnpm exec vitest run tests/desktop --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm exec esbuild apps/desktop/src/main/index.ts --bundle --platform=node --format=esm --external:electron --outfile=apps/desktop/dist/main/index.js
git diff --check
```

The new controls cover usable B state while A is still stalled, old cycle/SSE
completion, protected-save timing, concurrent pairing, Quit, a stale pairing
receipt, client hashing/authorization, durable old-device queue retention,
current-device progress, invalid-code recovery and protected-save retry.
The existing stale native confirmation test now distinguishes stopping the old
observer for pairing from an unauthorized subsequent withdrawal.

## Scope limits

No actual Electron GUI, Windows safeStorage, installed Codex source, database,
cloud service or provider was run, and no secret was read. This is synthetic
regression evidence. Historical native and standalone model/source proofs keep
their original source identities; this change advances no live acceptance case.
Coordinated native/product revalidation and independent review remain separate.
The user-rejected PR #33 stays held, and the separately owned replacement UI
requires review and user acceptance. Railway and final release remain held.
