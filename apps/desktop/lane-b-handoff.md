# Lane B execution ledger and handoff

Plan: docs/briefs/lane-b.md; frozen base 73175daa1f3d55595fcfeb7fe6beab5db337b7c3.

Ruling: use the prepared checkout and this owned report as the ledger. Do not run skill workspace helpers outside lane ownership. Parent owns independent review; no nested agents.

Pre-flight: T04 preloads consume frozen DesktopBridge/PetBridge; T05 emits ObservationBatch; T07 durably commits that batch and cursor before upload; T09 transports only cloud CheckIn records. No competing renderer, schema, client, manifest or dependency changes.

Ruling: cloud excerpt sharing remains OFF until an actual named receiving model endpoint and explicit disclosure are configured. Source identity must be exact and native-selected; no profile scan. Missing acceptance evidence is BLOCKED.

## RESULT

In progress.

## CHANGED FILES

Pending.

## CONTRACT IMPACT

No shared changes authorized.

## TEST COMMANDS AND OUTPUTS

- Initial `pnpm test:contracts`: setup failure, node_modules absent. Frozen install required.

## LIVE EVIDENCE

- Local `codex --version`: codex-cli 0.166.0. Generated installed-version JSON schema into ignored local-data/lane-b-schema, without reading histories.

## BLOCKERS

- No configured Nemotron receiving endpoint, real cloud sharing disabled.
- Native and automatic live observation acceptance not yet run.

## COMMIT

Pending.

T04 core: three missing-module RED suites followed by GREEN 6/6 desktop tests; pnpm typecheck exit 0. Native process wiring and Windows acceptance remain pending. Credentials use Electron protected-storage port with explicit temporary memory option; tokens never enter the bridge result.

T05 adapter: initial missing-adapter RED suites; GREEN 8/8 observer tests. Installation-layout regression failed on wrong codex/bin path, corrected against installed npm launcher, then passed. Scope probe validated own build/test vendor identity 01a1b7f4-77a3-7331-a770-5d81703b2746 in this exact checkout, tail enrollment returned zero observations at offset 57. No list/archive/start/resume/turn/tool/approval calls. Two fresh completed live updates remain BLOCKED; current source turn is in progress. No raw source content is in the report.

T07/T09 core: missing-module RED for consent/spool/revoke/reconnect/presentation; GREEN 23/23 desktop tests and typecheck exit 0. A behavior regression caught revoked excerpts retained in .previous; scrubbed both primary and recovery snapshot, then GREEN. Real filesystem tests exercise Windows atomic replacement/reopen and previous-valid recovery custody; corruption blocks instead of resetting. Ruling: one active selected source globally for the demonstrated baseline; revoke before selecting replacement. No live receiving service or disconnected cloud cycle has been exercised.

Native/process integration: controlled native smoke PASS on actual Windows Electron 45.2.3, including second-process lock denial, separate sandbox preloads, no renderer Node/token, forbidden IPC, nonfocused topmost pet, tray Open/Hide/click-through callbacks, close-to-tray, work-area clamp, protected async encryption/restart decryption, and stop-before-flush Quit. Initial native smoke failed (ESM top-level ready deadlock, then invisible workspace with windowsHide:true); corrected the smoke entry and used windowsHide:false for the visible Electron child. Parent root script change requested; root file untouched. Product C renderer, physical tray clicks/display unplug and full live question/answer remain unverified. A disconnect-race regression failed then passed; failed writes now block successful Quit flush; persisted read blockers survive restart. Native runtime uses real PlaybooksClient and SSE invalidation, never inference scheduling. Local reads remain independent of temporary cloud loss. Metadata revision hashes now depend only on permitted exported fields; failing privacy regression proved withheld message text and command output previously affected hashes.

Final observer correction: active-turn enrollment regression failed against raw-prefix hashing, then passed using identity-only skipped-baseline fingerprints; committed observation prefixes remain sealed against rewrites. Synthetic loopback HTTP test uses the actual frozen PlaybooksClient: two requests after a committed/lost response create one logical downstream update, preserve the same operation ID/payload and cursor, then prune the acknowledged queue. This is synthetic integration evidence only.
