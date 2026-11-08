# shadcn desktop foundation handoff

Foundation leaf for [parent candidate PR40](https://github.com/Skytuhua/NemoPlaybook/pull/40), targeting `feat/shadcn-desktop-shell`. Common source `1bc49ade09499f46fe048546ad202a5e0ee1efc4`; integration base `f04fa8a03fb6a212388182fd29825843f3f23638`. Started clean on `t3/shadcn-ui-foundation`, cwd `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-46160ee9`, source tree `39c09174addb4ba631ca2b824e79409270905cad`.

## Custody and dependencies

The only copied component source is the [Radix new-york-v4 registry at shadcn-ui/ui revision 42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9](https://github.com/shadcn-ui/ui/tree/42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9/apps/v4/registry/new-york-v4/ui). [The inventory](../../packages/project-ui/src/ui/provenance.json) records each original URL, byte length, Git blob SHA1, SHA256, local SHA256 and adaptations. [MIT license](../../packages/project-ui/src/ui/LICENSE.shadcn.md) is unchanged (1,063 bytes; SHA256 `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f`). No repository-wide scaffold, OpenBot source or second-phase domain edits were imported. Skeleton is the sole additional component, required by SidebarMenuSkeleton; cn is a local clsx/tailwind-merge helper replacing the registry's package re-export. The mobile hook was deliberately removed with the mobile rendering branch.

Exact added dependencies, at their consuming packages:

| Package | Version | Consumer |
| --- | --- | --- |
| tailwindcss / @tailwindcss/vite | 4.3.5 / 4.3.5 | apps/web development/build |
| radix-ui | 1.8.1 | project-ui |
| react-resizable-panels | 4.19.1 | project-ui |
| lucide-react | 1.70.0 | project-ui |
| class-variance-authority | 0.7.1 | project-ui |
| clsx | 2.1.1 | project-ui |
| tailwind-merge | 3.7.0 | project-ui |
| react-dom | 19.3.1 | project-ui peer consumer |

React remains 19.3.1, pnpm 10.30.3, Vite 8.3.6. Tailwind plugin's published peer range includes Vite 8; selected primitives accept React 19. No existing dependency version or integrity changed (all 226 baseline package entries compared unchanged). pnpm reordered some entries and added the necessary transitive dependencies, including Tailwind's jiti optional Vite peer context. The radix-ui umbrella brings its own primitives transitively; only the selected component source was copied. No extra animation package: animation-plugin-specific classes were removed from Sheet/Tooltip.

Baseline install: `pnpm install --offline --frozen-lockfile --ignore-scripts`. Necessary exact additions used `pnpm --filter <consumer> add --save-exact --ignore-scripts <name@version...>` (Tailwind uses `--save-dev`). The final manifests and lock were reconciled with `pnpm install --lockfile-only --ignore-scripts`, then installed with `pnpm install --offline --frozen-lockfile --ignore-scripts`. No audit/autofix/upgrade or lifecycle scripts; no native Electron download/run.

## APIs and parent seams

Existing WorkspaceCatalog/evidenceLabel/taskLabel exports remain. New exports through `@living-playbooks/project-ui`:

- Button/buttonVariants, Input, Textarea; Avatar/Image/Fallback/Badge/Group/GroupCount; Separator.
- Tooltip/Trigger/Content/Provider; Sheet/Trigger/Close/Portal/Overlay/Content/Header/Footer/Title/Description.
- All upstream Sidebar subcomponents and useSidebar; ResizablePanelGroup/ResizablePanel/ResizableHandle.

SidebarProvider only manages controlled/uncontrolled `open` and invokes `onOpenChange`. It installs no cookie, persistence, global shortcut or viewport listener. Sidebar is always an in-flow `div`, filling its parent panel, with min-width/min-height zero. There is no fixed rail, gap, width variable, auto-mobile Sheet or alternate content tree. `side`, `variant`, `collapsible` remain metadata; the parent controls actual width/presentation. SidebarRail is a discrete toggle, with no misleading resize cursor. SidebarInset likewise adds no competing desktop layout.

ResizablePanelGroup passes the official v4 `GroupProps`; use `orientation="horizontal"`, not the old `direction` API. Panel sizes/constraints accept **numbers as pixels**, explicit `"240px"`, or strings such as `"30%"`; plain numeric strings are percentages. Both handles default to 8px, matching the approved 16px budget. Keep stable panel IDs. The official library owns pointer and keyboard mechanics. `panelRef.getSize()` returns `{ inPixels, asPercentage }`; `onResize` receives the same size shape. `onLayoutChanged(layout, meta)` exposes `meta.isUserInteraction` for pointer/keyboard changes and `meta.requestedLayout` before constraints. The layout map uses percentages: convert using the actual measured panel space, accounting for handles, or read panel pixel sizes. Do not persist automatic constraint/viewport or imperative updates as user preferences. Parent connects the layout child's validated controller, reset action and preferred/effective widths.

### Sheet lifecycle is deliberately bounded

SheetContent adds `portal` (default true), `portalProps` (including `container`), `showOverlay` and forwards `forceMount` to both Portal and Content. SheetPortal and TooltipContent add `.workspace-ui` scope wrappers in their portals. SheetOverlay is hidden in its closed state. With `portal={false}`, Content remains in its current React host; parent supplies relative/in-flow versus fixed styles.

**The tests prove identity only across open/close while `modal={false}`, `portal` and the portal container stay invariant.** Both invariant portal=true and portal=false paths retain the exact textarea node and local draft. Sidebar's editor remains the same node when the viewport changes because Sidebar has no responsive branch. This is a primitive contract, not an App breakpoint proof.

`forceMount` alone does **not** preserve editor identity across switching Portal placement/container, changing ancestors/keys, replacing panel/drawer trees, or changing `Sheet.modal`. In the installed pinned Dialog implementation, Content selects `DialogContentModal` versus `DialogContentNonModal` according to Root.modal; changing that prop replaces the underlying component. Modal Content also calls `hideOthers(content)` in a mount effect, including force-mounted closed content. Nonmodal Content has no focus trap or outside pointer exclusion. Therefore do not use a force-mounted modal drawer as an always-visible desktop panel without resolving its accessibility effects, or claim that a modal-prop switch is safe.

Parent must keep one Chat/editor DOM host across the breakpoint and separately implement/test the presentation, inert/background keyboard exclusion, focus trap/return, Escape/backdrop dismissal, and mutually exclusive drawers. A stable nonmodal Sheet path is available for that composition; its focus management is the parent's responsibility. No application auth, editor state, responsive controller, focus manager or storage was added to these primitives. Do not infer a complete accessible responsive shell from these tests.

### CSS isolation and native constraints

`workspace-ui.css` imports Tailwind's **theme only** and emits utilities from the official `@tailwind utilities` entry nested inside `.workspace-ui`; Preflight is omitted. Explicit sources cover the shared primitives and web app directory. Generated utilities target descendants: put `.workspace-ui` on an ancestor of utility-bearing primitives. Portals provide that ancestor themselves. The root receives neutral black tokens, Geist 15px and dark color-scheme. Local scoped baseline rules replace the portions of Preflight needed by controls/lists; no global body/heading/button/font reset is added. Tailwind may emit global custom-property defaults/registrations and keyframes; visible reset, token application, typography and utility effects remain scoped. Pet source, CSS and approved mouse PNG are unchanged.

**Parent must retire/isolate the legacy unlayered workspace rules** in root styles.css: unlayered global button/input/heading rules outrank the new layered utilities even though workspace-ui.css is imported afterward. Do not add competing overrides in this leaf. The prior DESIGN.md describes an older light surface; the user-approved black/Geist15 plan wins. Impeccable's detector reported only Geist overuse and the intentional 15px/selection-gray departures from that older document; no design documents were changed here.

No CSP/connect-src change was made. Native packaged behavior of Radix portals/focus/scroll locking, third-party dynamic styles and resizable cursors remains unverified under the existing strict CSP. Keep that native gate held; do not weaken CSP to label local fixture tests native acceptance. No runtime network or remote font.

## Verified font and bounded audit

Copied **only** unchanged `geist-variable.woff2`, README.md and OFL.txt from the read-only interrupted checkout's font folder, after verifying the font length/hash and comparing both font and license bytes against [vercel/geist-font revision ef2597cfc42f4797676df105517ccc0a1cfa6569](https://github.com/vercel/geist-font/tree/ef2597cfc42f4797676df105517ccc0a1cfa6569). Original font path is `fonts/Geist/webfonts/Geist[wght].woff2`; license is `LICENSE.txt`.

- Font: 69,760 bytes, SHA256 `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`.
- OFL 1.1: 4,368 bytes, SHA256 `930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137`.
- Auditor admits only `apps/web/dist/assets/geist-variable-<Vite suffix>.woff2` at that exact size/digest. Unknown name/format, no suffix, mutation, truncation, appended bytes and arbitrary binary remain blocked.
- All existing inventory/count/size/link/re-read/UTF-8/credential scanning bounds remain. Only that verified font bypasses text decoding; ordinary output is still scanned. Mouse PNG exception remains exactly unchanged.

The font is present in the current output because the new stylesheet is imported. App is not composed with these primitives in this leaf; font inclusion does not establish that the new shell is visible or approved.

## Local evidence and limits

Only local bounded checks were run. Logs are in this checkout's ignored `.superpowers/foundation/` and are not portable acceptance evidence.

| Check | Observed result |
| --- | --- |
| `node --import tsx --test tests/build-output-audit.test.ts` RED | 62 passed / 2 failed: valid-font admission was blocked and its presence prevented subsequent credential scanning. Mutation/name rejection cases already passed. |
| Same command GREEN | 64/64 passed, including all preexisting bounds and sprite fixtures. |
| `pnpm exec vitest run tests/ui/shadcn-foundation.test.tsx` RED against imported source | 4/4 failed: cookie write; Ctrl+B toggle; viewport branch loses editor; nonportal option ignored. |
| Same focused file GREEN | 5/5 passed (both stable portal paths covered). |
| Production CSS assertion RED/GREEN | Initial shared source path emitted no utility classes; corrected path and production output now contains `.workspace-ui .flex` and `.workspace-ui .bg-sidebar`, without unscoped `.flex` or Tailwind Preflight. |
| `pnpm typecheck` | Passed. |
| `pnpm test:ui` | Final run 92/92 passed, 13 files. |
| `pnpm test:contracts` | 65/65 passed, 12 files. |
| `pnpm build` | Passed; compiles web, desktop and backend only, runs no app or service. |
| `pnpm exec tsx scripts/audit-build-output.ts` | PASS; exact final manifest receipt recorded below. `secretAbsenceProven` remains false. |

Final production output audit: 12 files, 6,482,833 total bytes; canonical manifest SHA256 `5b0610231778f5adc6e367698f518114b36e6e338caa5ded248d8a958f7faf70`. Included `geist-variable-DPGgOCY9.woff2` at the pinned size/hash and unchanged approved mouse PNG. Production CSS is 44,108 bytes. This is a build-local receipt; a parent composition rebuild will have its own manifest. The final build exited 0; an earlier build emitted a non-fatal plugin timing advisory.

Author review checked the scoped diff, source inventory/hashes, unchanged baseline dependency entries and no whitespace errors. It is not independent review. Parent review and native/visual/interaction acceptance remain pending. No browser/app/dev server, native GUI, database/service, provider/model/source/export/reminder, VM/deployment, full/cloud suite, prior blocked test retry, or acceptance-ledger promotion. No PR watch/merge/self-archive/children. PR33 remains DRAFT/HOLD/unaccepted. Held checkout and side preview/session remain untouched. User first-shell visual approval remains the gate before phase-two domain migration.

## Parent correction and divider regression

Independent review at `13ff50a` found that `w-2` and the orientation-specific
`h-2` use rem spacing: the incumbent 14px root produces 7px handles, contradicting
the 16px combined layout budget. Commit `47f8995311f18aad358f85d0bbb0f4716d4f0d01`
already corrects both dimensions to explicit 8px utilities and refreshes the
adapted component's provenance digest; the parent preserved that commit.

The parent added four source-to-generated-CSS regressions. They render actual
v4 separators in both group orientations, compile the rendered dimension utility
with the consuming package's pinned Tailwind compiler, and resolve its pixel
budget under 14px and 16px roots. Against `13ff50a`, both 14px cases failed with
**7 versus 8**; the 16px controls passed. After the preserved correction,
**9/9 foundation tests PASS**. An initial test-harness URL-resolution error was
fixed before this meaningful RED run and is not feature evidence.

This is compiler/static-markup evidence, not browser geometry or native proof.
The combined shell still needs real divider, drawer and editor-lifetime checks.
Parent typecheck, production build and whitespace checks passed. The fresh bounded
audit passed: 12 files / 6,482,803 bytes, manifest SHA256
`47bbaa60ca93d0636e43796f13cc397c303c142639940cfbeac411e934308dfe`.
Font/mouse bytes remain unchanged and `secretAbsenceProven` remains false.
The earlier full UI/contracts and 64-auditor-fixture receipts above remain
historical; they were not repeated for this test-only follow-up. Fresh independent
correction review and exact-head hosted checks remain pending.
