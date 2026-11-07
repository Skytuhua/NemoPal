# Lane C execution ledger and handoff

## RESULT
Implemented the Lane C renderer baseline for approved T06/T09 at frozen base `73175daa1f3d55595fcfeb7fe6beab5db337b7c3`. Native and live exit gates remain open for parent integration. No nested agents, real model/source reads, deployment, new dependencies, root-manifest changes, shared-contract/client changes, merges, or force pushes.

The workspace has left project identity/status/unread markers, a majority-width useful center, and only the selected manager's chat. Below 900px, Projects/Workspace/Chat explicitly select one surface. All six trusted flat panel variants resolve canonical records. Owner task corrections and plan acceptance use revisioned commands; status labels retain source/owner evidence distinctions. New projects have unknown progress and no invented readiness.

IndexedDB persists document, chat, and new-project input drafts. Switching waits for persistence; a failed write remains a blocker even if an unrelated key later succeeds. Concurrent typing during save survives. Document revision conflicts preserve the owner copy and expose canonical text separately, including when native IPC omits custom error codes. Stable panels/editors retain focus; a structural rearrangement requires owner application during editing. Invalid layout retains the last valid layout or a plain trusted checklist after canonical data revalidation. Late A reads and mutation completions cannot populate or invalidate B.

Desktop source controls use only DesktopBridge. Selection, local read consent, best-effort filtering acknowledgment, export policy, named endpoint consent, pause/revoke and pending cloud revocation are explicit. Native unavailable controls stay disabled. Local pet preference application is explicit. Source freshness, cloud transport state and Nemotron availability are separate.

Pet route is `index.html?surface=pet`. It uses only PetBridge, validates safe events, fences foreign questions, deduplicates identical repeated events locally, suppresses questions under focus/hide/offline/snooze, and submits revisioned answer/snooze commands. Original local SVG artwork covers idle/reviewing/waiting_for_you/milestone/snoozed/offline. Main remains responsible for eligibility, pinned/selected project authority, persisted presentation dedupe and native visibility. No pet scheduler or model calls exist in the renderer.

## CHANGED FILES
- `apps/web/index.html`, `vite.config.ts`, `lane-c-handoff.md`.
- `apps/web/src/main.tsx`, `styles.css`, `env.d.ts`, `favicon.svg`.
- `apps/web/src/app/{App.tsx,runtime.ts,snapshots.ts}`.
- `apps/web/src/features/chat/Chat.tsx`, `features/checkins/Question.tsx`.
- `apps/web/src/features/documents/{DocumentEditor.tsx,drafts.ts,useDraft.ts}`.
- `apps/web/src/features/sources/SourceControls.tsx`, `src/pet/Pet.tsx`.
- `packages/project-ui/src/{index.ts,WorkspaceCatalog.tsx}`.
- `assets/pet/{README.md,idle.svg,reviewing.svg,waiting_for_you.svg,milestone.svg,snoozed.svg,offline.svg}`.
- `tests/ui/{catalog,drafts,pet,project-switch,sources,states,workspace}.test.tsx`, `runtime.test.ts`, `helpers.ts`.
- `tests/ui/{inspect,storage-check,release-check}.mjs`.
- `tests/ui/artifacts/initial/{01-desktop,02-mobile,03-landscape,04-pet}.png`.
- `tests/ui/artifacts/confirmation/{01-desktop,02-mobile,03-landscape,04-pet}.png`, `confirmation/checks.json`.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/surfaces/workspace.md`, `.impeccable/design.json`.

No existing web package manifest or another lane's files changed. `git diff --name-only <base> -- package.json pnpm-lock.yaml packages/contracts packages/api-client` produced no output.

## CONTRACT IMPACT
No shared edits or requested contract/dependency changes. Uses frozen PlaybooksClient, DesktopBridge, PetBridge and six WorkspacePanel variants. Desktop map requires a revision for cancelJob even though the shared client method's envelope makes it optional; the adapter validates that requirement and has no job-cancel UI. Main owns authentication, tokens and SSE. The renderer has no HTTP client instantiation or source-grant path through PlaybooksClient.

Runtime selection is explicit: preload -> typed desktop client adapter; development plus `VITE_DEV_FIXTURES=true` -> shared fixture client; otherwise explicit unavailable UI. Preload failure never falls back. Snapshot fixture provenance also triggers the banner, including through a desktop adapter. Production HTML has strict script/style CSP and `connect-src 'none'`; only the Vite development server permits its injected refresh/style tags and loopback HMR.

## TEST COMMANDS AND OUTPUTS
- `pnpm install --frozen-lockfile`: existing pinned packages installed, no lockfile change.
- Initial `pnpm test:ui`: **7 expected assertion failures** against the empty workspace scaffold; all 7 subsequently green.
- Pet scaffold regression run: **4 expected assertion failures** (missing question/identity/art/answer controls); runtime scaffold: **2 expected failures** (missing intentional fixture/client transport).
- Expanded suite caught late-A mutation invalidating a loading-B request; early project fencing fixes it.
- Further observed red regressions: missing source-revocation status/preferences, canonical pet answer still displaying a pending caption, desktop-supplied fixture labeling, reload of unfinished project briefs, lost IPC error codes, and real IndexedDB flush hiding an earlier failed key. Each has a green regression.
- Final `pnpm test:ui`: **8 files, 26 tests passed**, exit 0.
- `pnpm test:contracts`: **10 files, 43 tests passed**, exit 0. Existing foundation tests; no shared implementation edits.
- Final `pnpm typecheck`: **exit 0**.
- `node tests/ui/storage-check.mjs`: initially failed `{rejectedWrite:true,rejectedFlush:false}`; after per-key failure custody, **PASS real IndexedDB: a successful unrelated draft cannot conceal an earlier failed project write.**
- `node tests/ui/inspect.mjs initial`: missing bundled Playwright browser required installed Edge; development CSP was adjusted for Vite. One valid batched initial capture then reported only a favicon 404. The single combined fix handled favicon, transparent pet root, global error visibility and storage failure custody.
- `node tests/ui/inspect.mjs confirmation`: **PASS desktop, 375px, landscape, IndexedDB reload, keyboard focus, 44px targets, six panels, reduced-motion pet.** Center measured 936/1440px; document width equaled 375px and 812px viewports; zero small visible native controls in the checked set; 3px keyboard outline; zero console errors. Local checkbox labels provide 44px hit areas. No further screenshot/polish loop.
- `node tests/ui/release-check.mjs`: builds `apps/web/dist` and then **PASS release browser: explicit workspace/pet unavailable without preload, no fixture fallback, strict CSP, no renderer connections.** It intentionally sets the fixture environment variable during production build and still receives unavailable UI.
- Final web build output: **133 modules transformed; index.html 0.65kB, CSS 7.39kB, JS 372.11kB (111.06kB gzip)**, exit 0.
- `pnpm test:desktop`: **exit 1, No test files found** in this frozen isolated lane checkout. This is missing Lane B integration, not desktop acceptance.
- `pnpm build`: **exit 1, Build blocked: apps/cloud/src/main.ts is not implemented yet.** Parent must combine Lane A/B outputs for full build.
- `git diff --check`: exit 0. Root manifests/lockfile and consumed contracts/client remain unchanged.

## LIVE EVIDENCE
**No live acceptance claimed.** Only synthetic local jsdom/Edge renderer evidence exists. The browser batch verified actual IndexedDB reload, responsive navigation, six panels, local SVG loading, reduced motion and focus/target geometry. Confirmation artifacts are under `tests/ui/artifacts/confirmation/`. The last conflict change affects error recovery only and has focused unit evidence; no claim of a rendered native conflict dialog or Electron IPC cycle.

No tokens, pairing secrets, real provider calls, private source histories, observation reads, account writes, hosting, SMS, MCP or phone extension were used. No native tray interaction, physical DPI, screen-reader, dark-theme, production or hosted testing was performed. The shipped surface deliberately uses a light theme.

## BLOCKERS
- Native presentation custody/deduplication, selected/pinned project authority, focus/hide window behavior, and a real closed-to-tray question/answer cycle require Lane B and parent integration.
- Live Nemotron planning/response/tool behavior remains unavailable while configuration is absent. Fixture message sending is disabled; drafts remain usable. New fixture projects remain unknown/queued rather than inventing tasks or inference completion.
- Cloud deployment, authentication setup, durable live dispatch and real source observation/export acceptance remain unverified and owned by the relevant lanes/parent.
- Full repository build and desktop focused test gates cannot pass in the frozen C-only checkout, for the exact missing artifacts above.
- Final independent review/integration belongs to parent. No reviewer or other nested child was spawned. Native compatibility must be reviewed against Lane B; this report is not independent approval.

## COMMIT
Sequential focused implementation commits:
- `8e17085` — project workspace, revisioned edits, draft persistence and initial regressions.
- `27b3ef7b5d62d27fa79bc012809d92636a4a186d` — restricted pet, renderer capability modes, responsive shell, hardening regressions and evidence.

This report is committed afterward as a documentation-only deliverable. Branch: `t3/living-playbooks-ui-baseline`. PR base: `feat/foundation-contracts` (foundation PR #1 is still open at the frozen head). The final PR URL and report commit HEAD are returned in the agent handoff. No merge or force push.

## Rulings
- The provided approved exact UI direction settles Impeccable's design questions; no new concept/approval round. App screens build code-first.
- Impeccable context ran once from the prepared cwd; it returned TARGET_SELECTION_REQUIRED despite the task already naming apps/web. Required fallback notice was sent, context was read directly, and the helper was not rerun.
- UI/UX design-system search returned a portfolio recommendation. Applied only its relevant keyboard/focus/motion/contrast guidance; the owner's Operate layout and React/Vite stack govern.
- Nested reviewers/documenters are prohibited; parent performs the independent review. Local bounded checks remain implementation evidence.
