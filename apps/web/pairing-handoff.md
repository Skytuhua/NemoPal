# Lane C desktop pairing bootstrap handoff

## RESULT

Implemented the renderer pairing prerequisite for approved T06/T09, J1 and T14 setup on base `0452ee0af9093391d1bec78049b355bf861131b2`, branch `t3/desktop-pairing-bootstrap`. No merge or force push. This is a prerequisite, not completion of the native/live integration gates.

Desktop workspace startup now checks strict frozen capabilities before constructing the existing runtime/client, draft store or App. Loading, unavailable, unconfigured destination, unpaired, pairing and paired states are explicit. A valid already-paired desktop opens directly. An unpaired desktop shows its configured HTTP(S) origin and accepts an operator-issued code plus device name through `DesktopBridge.pair` only.

Input uses `PairingInputSchema`, including UTF-8 byte limits, after trimming surrounding whitespace. Strict `PairingResultSchema` validation rejects malformed/extra fields; a supplied expired result also fails closed. A positive pair result must be followed by a fresh strict capability response with `paired: true` and the same destination. Failed confirmation or a changed destination requires Retry connection before accepting another code. Duplicate submission is fenced; unmount invalidates pending completions. Errors use fixed recovery copy, never raw provider/network reasons.

The password input is uncontrolled and never stored in React state. It clears before bridge submission or validation failure and on form removal/unmount. Code exists only in the input and ephemeral submission memory; no draft/store/storage/URL/logging path receives it. No bearer-token field or renderer HTTP/auth implementation was added. Runtime/client, App, useDraft and native authority are unchanged.

The existing pet branch remains in main.tsx and still renders Pet through window.pet. Missing preload retains the original unavailable screen. Synthetic fixtures still require both development mode and explicit VITE_DEV_FIXTURES=true; their existing label remains visible. A present but failed/unpaired bridge never falls back to fixtures.

## CHANGED FILES

- `apps/web/src/main.tsx`: delegate only the workspace branch to WorkspaceRoot.
- `apps/web/src/app/WorkspaceRoot.tsx`: gate existing runtime/App construction and preserve missing-bridge/fixture behavior.
- `apps/web/src/features/pairing/PairingBootstrap.tsx`: bounded bootstrap/form/confirmation states.
- `apps/web/src/styles.css`: one form-width rule using existing primitives.
- `tests/ui/pairing.test.tsx`: entry-point tests with synthetic bridges and storage spies.
- `apps/web/pairing-handoff.md`: this handoff.

No dependency, lockfile, schema, signature, API-client, App.tsx, useDraft, pet implementation, original workspace/regression-test, cloud, desktop, observer, deployment or live/e2e edits.

## CONTRACT IMPACT

None. Consumes existing DesktopCapabilitiesSchema, PairingInputSchema, PairingResultSchema, DesktopBridge.capabilities/pair and runtime(). The configured cloudOrigin must be a canonical HTTP(S) origin (URL.origin), with no credentials, path, query or fragment. Null/empty destination is unavailable for pairing; malformed destinations fail closed.

Parent integration must provide the frozen complete capability response and publish paired=true only after desktop authority has accepted pairing. Desktop main remains responsible for token custody, pairing-code redemption, configured destination, authenticated commands and SSE. Renderer bootstrap does not establish native, backend or model readiness and does not monitor later authentication revocation inside the existing App.

## Direction contract

THESIS: Let the owner pair the desktop before opening projects, with the destination and one primary action visible.

OWN-WORLD: Preserve root PRODUCT.md/DESIGN.md and the incumbent light neutral, Segoe UI, forest focus, brick error, flat surfaces and native 44px form controls.

STORY: Check connection, recognize destination, enter operator code/device name, wait for confirmation, then use the existing workspace.

FIRST VIEWPORT: Reuse the unavailable page's single-column spacing; heading, explanation, destination, two labeled fields, nearby status/error and Pair desktop.

FORM: Ordinary extension using existing primitives; no new visual system, assets, concept round or screenshot round was requested. Native keyboard controls, status announcements and recovery focus remain explicit.

FINISH: Bounded source review, synthetic entry-point tests, mechanical detector and build/type verification completed; parent performs independent review and native/live acceptance. Existing design documentation remains authoritative and unchanged.

## TESTS AND RED/GREEN

Environment: Node v24.14.0, pnpm 10.30.3. `pnpm install --frozen-lockfile` passed using cached pinned packages; no manifest/lock changes. The first test invocation before install reported missing vitest; that infrastructure failure is not RED evidence.

- RED: `pnpm exec vitest run tests/ui/pairing.test.tsx -t 'workspace commands wait|unpaired desktop shows'` -> 2 expected assertion failures, 32 skipped. Existing main sent listProjects before capabilities resolved; no Pairing code form existed. Tests imported actual main.tsx, not a missing-module scaffold.
- Initial GREEN: `pnpm exec vitest run tests/ui/pairing.test.tsx` -> 34 passed. During implementation, typecheck identified a union-narrowing issue and a synthetic fixture missing the required nativePet failure reason; both were corrected.
- Additional RED: `pnpm exec vitest run tests/ui/pairing.test.tsx -t 'a changed destination must'` -> 1 expected failure, 34 skipped. Confirmation failure still exposed a stale destination form. Fixed by requiring a capability reload, covered by the 35th test.
- Final focused GREEN: `pnpm exec vitest run tests/ui/pairing.test.tsx tests/ui/review-regressions.test.tsx` -> 2 files, 46 tests passed (35 pairing plus all 11 retained review regressions), exit 0.
- `pnpm test:ui` -> 10 files, 72 tests passed, exit 0; includes 35 pairing tests and all 11 retained review regressions.
- `pnpm test` -> 21 files, 131 tests passed, exit 0. Available unit/contracts and UI tests only; this checkout has no tests/cloud or tests/desktop directories.
- `pnpm typecheck` -> exit 0.
- `pnpm exec vite build --config apps/web/vite.config.ts` -> exit 0; 135 modules, JS 378.61 kB (112.81 kB gzip), CSS 7.43 kB.
- `git diff --check` -> exit 0.
- One Impeccable detector pass over main, WorkspaceRoot, pairing component and styles -> no findings on added UI; 11 advisory findings in existing stylesheet colors/type sizes, outside this change's one added width rule. No design drift repair.

Coverage includes capability pending/rejection/malformed/unconfigured states; no workspace invoke or draft construction before pairing; already paired; validated/trimmed input; busy/duplicate submission; expired/rejected/false/malformed/extra-token results; canonical confirmation mismatch/rejection; changed-destination reload; new-code retry; password clearing; synthetic draft/browser-storage/URL/log spies; late unmount results; fixture/missing-bridge/pet routing.

## LIVE EVIDENCE

None. All interaction evidence is synthetic jsdom and mock bridge/storage evidence. It proves neither actual IndexedDB persistence nor real preload, Electron/Windows behavior, OS/password-manager handling, server redemption, native token custody, provider access, model/source reads, hosted deployment, live J1 workflow or visual acceptance. No backend/model/source reads, paid calls, native launch, browser preview, screenshot round, account changes or extra children were performed.

## BLOCKERS / PARENT FOLLOW-UP

No implementation blocker or shared-file change requested. Parent owns independent review, any native/cloud join, real operator-issued-code test, authenticated project listing and restart/expiry/revocation checks. This work leaves those integration gates open.

The prepared isolated branch was reused. No shell worktree was made; other branches and protected files were retained. This implementation agent does not watch, merge or self-archive. Parent acknowledges the delivered result, confirms task_status completed/result_available/hasPendingChildRuns=false and then recoverably archives the returned childThreadId.
