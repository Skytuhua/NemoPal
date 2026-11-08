# Lane B execution ledger and handoff

Plan: docs/briefs/lane-b.md; frozen base 73175daa1f3d55595fcfeb7fe6beab5db337b7c3.

Ruling: use the prepared checkout and this owned report as the ledger. Do not run skill workspace helpers outside lane ownership. Parent owns independent review; no nested agents.

Pre-flight: T04 preloads consume frozen DesktopBridge/PetBridge; T05 emits ObservationBatch; T07 durably commits that batch and cursor before upload; T09 transports only cloud CheckIn records. No competing renderer, schema, client, manifest or dependency changes.

Ruling: cloud excerpt sharing remains OFF until an actual named receiving model endpoint and explicit disclosure are configured. Source identity must be exact and native-selected; no profile scan. Missing acceptance evidence is BLOCKED.

## RESULT

Implemented T04/T05/T07 and B-owned native T09 transport. Deterministic checks and controlled Windows boundary smoke pass. Automatic live observation, cloud sharing and the complete native product question cycle remain BLOCKED.

Branch `t3/living-playbooks-observer` now includes main `0452ee0af9093391d1bec78049b355bf861131b2` by normal merge. PR targets `main`. No nested agents, merge or force push. Parent owns independent review/integration.

Delivered: secure separate preloads/windows, strict sender/frame/origin/project/operation checks, single instance and tray controls; asynchronous protected credentials with explicit temporary-memory option; one pinned Codex 0.166.0 stored-history strategy; explicit local-read/export consent; bounded atomic cursor+batch journal; durable idempotent uploads; revoke-first sync and persisted presentation identities; stale/offline question fencing. No model or source prose grants native authority.

## CHANGED FILES

Only owned areas differ from merged main:

- `apps/desktop/src/main/{index,native-windows,windows,tray,ipc,credentials,pairing,consent,local-store,source-controller,sync,presentation}.ts`
- `apps/desktop/src/preload/{workspace,pet}.ts`
- `packages/codex-observer/src/{index,adapter,cursor,normalizer,transport}.ts`
- `fixtures/codex/synthetic.ts` (explicit Lane B ownership exception)
- `tests/desktop/*.test.ts`, `native-smoke-app.ts`, `native-open-project.patch`
- `tests/live/{native,observer}.ts` and this report.

No B edits to root manifests/lockfile, shared contracts/client, cloud code, React renderer or pet art. The main merge preserves C/foundation changes unchanged.

## CONTRACT IMPACT

No shared signatures or schemas changed by B. Cursor fingerprints and journal envelopes are local details and never enter cloud payloads.

Lead acknowledged ownership of additive `SafeDesktopEvent { type: 'open_project', projectId }`, the App consumer/draft flush, and launcher `windowsHide:false`. After that schema lands, apply `tests/desktop/native-open-project.patch`; `git apply --check tests/desktop/native-open-project.patch` passes against this branch. It adds native emission from the already validated current pet-project callback. Applying before the additive schema would intentionally fail typecheck. Until integration, Open project reveals the workspace window only. No parent-owned files were changed.

Renderer handoff: workspace `window.playbooks`, restricted pet `window.pet`; requests `lp:workspace`/`lp:pet`, safe events `lp:workspace-event`/`lp:pet-event`. Frozen built paths remain `apps/desktop/dist/main/index.js`, `dist/preload/{workspace,pet}.cjs`, C's `apps/web/dist/index.html` and `index.html?surface=pet`.

## TEST COMMANDS AND OUTPUTS

- Initial `pnpm test:contracts`: setup failure, node_modules absent. Frozen install required.

Final resumed verification after merging main and completing source/export gates:

```text
pnpm test:desktop -> 17 files passed; 32 tests passed
pnpm test -> 37 files passed; 128 tests passed
pnpm typecheck -> tsc --noEmit; exit 0
pnpm evidence:check -> 36 cases, 0 marked passed; ledger valid
pnpm test:native -> PASS, win32 Electron 45.2.3, controlled synthetic test HTML
git diff --check -> exit 0
git apply --check tests/desktop/native-open-project.patch -> exit 0 (not applied)
pnpm build -> BLOCKED: apps/cloud/src/main.ts is not implemented yet
```

The evidence checker does not independently execute acceptance. Desktop bundling is exercised by native smoke through existing root `buildDesktop`. The actual frozen HTTP client reconnect test records two identical requests after a committed/lost response, one logical downstream update, a preserved cursor and queue pruning after acknowledgement. That is synthetic loopback integration, not a live cloud/model result.

Behavior regressions observed failing before fixes: wrong installed executable layout; revoked excerpts retained in recovery snapshot; question presentation completing after disconnect; failed writes allowing successful Quit; read blockers disappearing on restart; active enrollment misclassifying completion of skipped items as history rewrites; metadata hashes depending on withheld text/output; foreign adapter grants reaching reads; undisclosed receiving endpoints advertising export; general metadata authorization entering the live reader. These now pass. Initial feature suites also failed on missing implementations before delivery.

## LIVE EVIDENCE

- Local `codex --version`: codex-cli 0.166.0. Generated installed-version JSON schema into ignored local-data/lane-b-schema, without reading histories.

- Actual Windows receipt rerun after main merge: second Electron process denied instance lock; distinct sandbox preloads, no renderer Node/token; forbidden IPC denied; small topmost pet shown without focus; tray Open/Hide/click-through callbacks; workspace close-to-tray; work-area clamping; async protected encryption and restart decryption; stop then flush before Quit. This uses controlled test HTML and native callbacks, not physical pointer acceptance or C product acceptance.
- An earlier own build/test source probe validated exact checkout metadata and tail enrollment with zero imported observations. Three read-only polls saw zero fresh completed batches and returned BLOCKED. This is not two-delta proof or proof of filesystem purity: initialization may write App Server logs/state. No raw source content or account files are in this report.
- After resumed narrower authorization, no real history/content observation was rerun. The live runner now requires an exact own source ID, named synthetic source and `LP_OBSERVER_LOCAL_READ_CONSENT=1`; general authorization permits metadata only and blocks before entering a reader. Native selection has no implicit current-thread fallback.

## BLOCKERS

- Two fresh completed updates from an explicitly consented named own synthetic source have not been demonstrated. Automatic live observation acceptance remains unavailable.
- No app-accessible receiving-model endpoint/disclosure exists. Export remains OFF; an API origin alone does not advertise or authorize sharing. No Brev, Nemotron, other model, paid resource, hosted deployment, MCP or phone extension was called.
- Root build currently blocks on the absent A-owned cloud entry point. No real cloud disconnect/reconnect model/check-in cycle was run.
- Lead's additive Open project schema/App integration and visible launcher correction are pending. The owned native patch is supplied; B did not edit App, pairing UI, root scripts or schemas.
- C product renderer plus native question/answer acceptance, physical tray clicks, physical monitor removal, animation/reduced-motion rendering and fullscreen/secure-desktop behavior remain unverified. The controlled native smoke does not claim them.
- Baseline limit: one active selected source globally. Pause stops it; replacement requires revoke/relink. Latest-20-turn history gaps require explicit revalidation, never silent backfill. Filtering is best effort; processed provider data cannot be recalled. No second observation strategy, installer, autostart or optional extension was added.

## COMMIT

Implementation series: `e8f138b`, `096f7db`, `8fe4ca5`, `99017dc`, `040e130`, `68eda68`; normal main merge `e571e8e`; final source/export gate implementation `363900b813f0ac537c7e28f052cbc65d41f64855`. Final report/patch commit is the PR head returned in the handoff. Parent receives/acknowledges the result, confirms completed/result_available/no pending children, then owns recoverable archival.

## EXECUTION LEDGER (historical intermediate results)

T04 core: three missing-module RED suites followed by GREEN 6/6 desktop tests; pnpm typecheck exit 0. Native process wiring and Windows acceptance remain pending. Credentials use Electron protected-storage port with explicit temporary memory option; tokens never enter the bridge result.

T05 adapter: initial missing-adapter RED suites; GREEN 8/8 observer tests. Installation-layout regression failed on wrong codex/bin path, corrected against installed npm launcher, then passed. Scope probe validated own build/test vendor identity 01a1b7f4-77a3-7331-a770-5d81703b2746 in this exact checkout, tail enrollment returned zero observations at offset 57. No list/archive/start/resume/turn/tool/approval calls. Two fresh completed live updates remain BLOCKED; current source turn is in progress. No raw source content is in the report.

T07/T09 core: missing-module RED for consent/spool/revoke/reconnect/presentation; GREEN 23/23 desktop tests and typecheck exit 0. A behavior regression caught revoked excerpts retained in .previous; scrubbed both primary and recovery snapshot, then GREEN. Real filesystem tests exercise Windows atomic replacement/reopen and previous-valid recovery custody; corruption blocks instead of resetting. Ruling: one active selected source globally for the demonstrated baseline; revoke before selecting replacement. No live receiving service or disconnected cloud cycle has been exercised.

Native/process integration: controlled native smoke PASS on actual Windows Electron 45.2.3, including second-process lock denial, separate sandbox preloads, no renderer Node/token, forbidden IPC, nonfocused topmost pet, tray Open/Hide/click-through callbacks, close-to-tray, work-area clamp, protected async encryption/restart decryption, and stop-before-flush Quit. Initial native smoke failed (ESM top-level ready deadlock, then invisible workspace with windowsHide:true); corrected the smoke entry and used windowsHide:false for the visible Electron child. Parent root script change requested; root file untouched. Product C renderer, physical tray clicks/display unplug and full live question/answer remain unverified. A disconnect-race regression failed then passed; failed writes now block successful Quit flush; persisted read blockers survive restart. Native runtime uses real PlaybooksClient and SSE invalidation, never inference scheduling. Local reads remain independent of temporary cloud loss. Metadata revision hashes now depend only on permitted exported fields; failing privacy regression proved withheld message text and command output previously affected hashes.

Final observer correction: active-turn enrollment regression failed against raw-prefix hashing, then passed using identity-only skipped-baseline fingerprints; committed observation prefixes remain sealed against rewrites. Synthetic loopback HTTP test uses the actual frozen PlaybooksClient: two requests after a committed/lost response create one logical downstream update, preserve the same operation ID/payload and cursor, then prune the acknowledged queue. This is synthetic integration evidence only.
