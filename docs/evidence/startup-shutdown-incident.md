# Startup/shutdown incident follow-up

Base: PR15 `6f8364742775b608d9a554880fc1274c7136efb4`, tree
`0fcf3c17f9bc3f17021d7b0b8f0c973f906e1831`, identical to the prepared
`6f49c94a928484732980aa2579dc9ffa7a2c79a5` tree. PR23's privacy corrections
remain inherited. Changes are limited to main, its synthetic harness, the new
startup/shutdown test, and this document. No children were started.

## Actual incident remains unresolved

Source: PR22 draft `7d10883`, `docs/evidence/native-checkin.md`, read from the
provided `t3-dff2123f` checkout. It records the actual **Living Playbooks blocked /
Native startup failed** dialog, the already-removed `lp-j1-product-bZ8CIv`
profile/PIDs, and the earlier immediate native-visibility assertion followed by
close fallback. The actual main startup promise rejected; its finer rejection
reason was not recovered. Early close causing navigation abort remains a
historical hypothesis. Neither a later native PASS nor this synthetic reproduction
establishes that incident's original cause. Native incident acceptance stays HOLD
pending parent review and coordinated native confirmation.

## Static trace and controlled reproduction

Static inspection: main installs tray Quit and `before-quit` before awaiting
`windows.load()`. Real `native-windows.ts` awaits both `loadURL` promises and
destroys both windows on shutdown. `CompanionLifetime.quit()` stops work, awaits
journal flush, then destroys windows/exits. The former startup continuation did
not check shutdown: load rejection reached the generic fatal handler, while late
load success attempted to show destroyed windows. The former `before-quit` guard
also stopped preventing default teardown once quitting was true and did not
report a rejected flush through the tray's sanitized Quit-blocked handler.

Confirmed synthetic category: **startup continuation racing intentional shutdown**.
The existing real-main harness now accepts a deferred window-load OS port and
tracks destroyed window state. Main, lifetime, IPC, vault, controller, sync and
journal code remain real; Electron/window, observer and HTTP ports are synthetic.
The pending-flush test delays and then delegates to the real `JournalStore.flush()`;
write-failure tests obstruct only a disposable journal's temporary write path.
No real navigation abort was induced or observed in this phase.

Meaningful RED, before production edits: eight tests, seven failures and one
passing unexpected-load-failure control. Four failures displayed startup fatal
after tray/before-quit shutdown with aborted or completed load. A second quit
failed to prevent teardown while flush awaited. A real temporary-journal write
failure produced an extra startup fatal after tray Quit, or an unhandled durability
rejection without Quit-blocked reporting through `before-quit`.

The local fix only handles shutdown at the pending `windows.load()` boundary,
returns before startup visibility when quitting, and routes both Quit entry points
through the same failure reporter while preventing default teardown on every
`before-quit`. `CompanionLifetime` still owns flush and successful exit. No exit
was added on the basis of quitting, no journal reset was added, and the outer
generic startup failure handler remains unchanged.

## GREEN and verification

Executed 2026-11-08 UTC, Node 24.14.0 / pnpm 10.30.3:

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run tests/desktop/startup-shutdown.test.ts tests/desktop/main-project-selection.test.ts tests/desktop/main-local-withdrawal.test.ts tests/desktop/main-restored-exports.test.ts tests/desktop/main-tray-withdrawal.test.ts tests/desktop/window-lifecycle.test.ts tests/desktop/journal-failure.test.ts tests/desktop/durability-privacy.test.ts
pnpm typecheck
pnpm exec tsx -e "import('./scripts/build.ts').then(m => m.buildDesktop())"
git diff --check
```

All eight affected test files passed: **60 tests**, including nine startup cases.
Typecheck and the desktop main/preload bundle passed. Tests cover aborted and
successful load completion after both Quit paths; pending asynchronous flush with
repeat `before-quit`; real failed journal writes preserving primary and `.previous`
bytes and preventing exit; and sanitized fatal reporting for both a generic load
failure and `ERR_ABORTED` when shutdown was not requested. GREEN has no unhandled
rejections. Package/dependency files were unchanged.

This lane ran no full DB suite, Electron/native UI/process, real source read,
model/provider/export, GPU, browser, cloud service or deployment. All journals and
credential bytes were disposable synthetic fixtures; the default AppData profile
and the removed incident profile were not accessed. Full-suite/baseline results
reported by the parent are separate from these focused receipts. No native or
visual acceptance, watch, merge or self-archive is claimed. Independent parent
code review and later coordinated native confirmation remain outstanding.
