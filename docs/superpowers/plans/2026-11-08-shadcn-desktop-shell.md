# NemoPlaybook desktop frontend rebuild with shadcn/ui

> User-approved implementation plan. Use superpowers, ponytail, impeccable and ui-ux-pro-max. Deliver a working shell for user review before migrating domain controls. Tests alone do not grant visual acceptance.

## Source custody and scope

- Start at integration `f04fa8a03fb6a212388182fd29825843f3f23638`. Keep React/Vite inside the existing Windows Electron app, native title bar, default window 1240x820 and minimum 800x600.
- PR33 `4e8056f82b134766431195eb0d3657a1978dbe3c` remains DRAFT/HOLD and unaccepted. Do not merge it wholesale into this replacement.
- Interrupted work at `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-de97fa15`, HEAD `8d3598affb84b1ed3bc4b194a4f2a758024e7dd9` plus uncommitted changes, is read-only reference material. Never resume its interrupted task, discard its files or transfer its passing-check labels to the new implementation.
- Preserve `C:/Users/user/Documents/NemoPlaybook` at held `8ff0245`, including build, private environment/key, one-shot marker and model accounting. No model/provider/source/export/reminder/DB/native GUI/VM/deployment actions or blocked-test workaround. Fixture renderer proof is synthetic only.

## Foundation

- Copy Radix-based shadcn components from immutable upstream `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`. Retain the MIT license and a per-file provenance/adaptation inventory. No OpenBot-owned source/assets.
- In existing `packages/project-ui`, add local Sidebar, Resizable, Sheet, Button, Input, Textarea, Tooltip, Separator and Avatar components, utilities and required hooks. Export them from the existing package entry point; use local imports rather than unresolved upstream aliases. Do not create another app/package or change framework.
- Add exact compatible Tailwind 4/Vite-plugin, Radix, react-resizable-panels v4, Lucide, class-variance-authority, clsx and tailwind-merge versions and retain the lockfile. Only add other upstream-required packages when needed by the selected components, documenting why.
- New theme/components apply to `.workspace-ui` only. Import Tailwind theme/utilities without global Preflight. Preserve the separate pet's CSS, typography, geometry, reduced-motion behavior and original PNG bytes.
- Use local Geist variable sans, body 15px, neutral black/near-black surfaces, subtle gray lines and white/gray text. No blue-tinted surfaces or runtime CDN. The verified reference font is 69,760 bytes, SHA256 `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`, from vercel/geist-font revision `ef2597cfc42f4797676df105517ccc0a1cfa6569`; retain OFL 1.1 and provenance. Build audit admits only that filename family, size and digest.

## Working shell contract

- One horizontal Resizable group owns Projects / Workspace / Manager widths. Do not combine it with a fixed-position desktop Sidebar wrapper or another custom pointer-resizing implementation.
- Left preferred width 240px, bounds 200-360px. Right preferred width 360px, bounds 300-560px. Center minimum 480px, accounting for 16px combined handle budget. Clamp against the measured container, preserve preferred widths across automatic shrink/widen, and provide pointer/keyboard handles plus Reset layout.
- Persist only validated, versioned width preferences in renderer localStorage. Reject malformed/nonfinite/wrong-version data; clamp finite out-of-range values. Storage failures fall back without disabling the app. No cookies, credentials or global shortcut installation from upstream Sidebar defaults.
- Below 1100 CSS pixels keep Workspace visible; Projects and Chat become mutually exclusive drawers. Escape/backdrop dismissal, focus trapping/return and background keyboard exclusion are required. Preserve one mounted chat/editor instance, DOM identity and drafts across breakpoint transitions.
- Container and panes use min-width/min-height zero and intentional scrolling. Project list scrolls; workspace scrolls when necessary; conversation log scrolls above an anchored composer. Remove the conflicting short-height document expansion and guessed chat height.
- Left: approved mouse mark, project filter/list, New project and settings. Center: project identity, compact progress/steps/current action, representative tasks/notes/evidence in content-fit containers. Right: bot/avatar, relevant existing check-in, conversation and composer. Content width is bounded inside the fluid center.
- Remove demo slogans and unnecessary header labels, including "Design target · Static demo" and "Sources & privacy". Retain one concise Demo disclosure and reachable real consent/withdrawal controls through settings; never erase real owner-authored text merely because a demo seed used similar wording.

## Parallel ownership and integration seam

Two isolated worktree children start from the common plan commit. They are not alone and must preserve others' edits. Neither spawns children, watches, merges or self-archives.

1. **Foundation worker:** owns copied primitives/utilities/hooks under `packages/project-ui/src/ui/`, its index exports/package dependencies, authorized dependency/lock/Vite configuration, new workspace theme/font files and the main stylesheet import, font audit/rejection fixtures and foundation-only evidence. Does not edit App, existing WorkspaceCatalog/domain features, root styles or native/cloud/client/contracts.
2. **Layout worker:** owns only new `apps/web/src/app/useDesktopPaneLayout.ts`, its focused UI tests and layout handoff. Uses existing React/tooling, no dependency/config edits. Exports `PaneWidths` (`projects`, `manager`), `Drawer` (`projects`, `chat`, null), and `useDesktopPaneLayout()` returning `containerRef`, `narrow`, `drawer`, `preferredWidths`, `effectiveWidths`, `openDrawer`, `closeDrawer`, `commitUserWidths`, and `resetLayout`. Measuring/clamping alone never rewrites preferred/persisted values. `commitUserWidths` consumes finite pixel widths only after a user resize; Resizable primitives retain ownership of actual pointer/keyboard mechanics. The controller does not move focus, mount children, touch auth or render a competing shell.
3. **Parent:** owns App/WorkspaceRoot composition, root-style retirement/isolation, data/demo presentation, integration of both leaves, actual Resizable/Sheet adaptation preserving mounted content, focused composition regressions and independent reviews. Only the parent edits these composition hotspots.

Child PRs target the parent's `feat/shadcn-desktop-shell` candidate. The first-phase candidate PR targets `feat/golden-workflow-integration` and remains draft/held for review. Link the full PR stack immediately after PR creation/push. Retain all branches.

## Review checkpoint and second phase

- First phase is the working shell using existing real client callbacks and intentional synthetic fixtures for bounded renderer review. It must demonstrate actual resizing, drawers, typography/icons, content containers and anchored composer. Obtain user shell approval before the following domain migration.
- Second phase: functional task checkbox (done/todo) plus other status choices; useful task details even for tasks already in the checklist; one next-action resolver (eligible suggested task, then in_progress, todo, blocked; never done/skipped); outcome-aware Mark task done label retaining recorded payload; not_yet retains the entire task; migrate remaining notes/evidence/check-ins/settings with revision, provenance, owner-edit and late-response fences intact.
- Do not silently import the interrupted branch's second-phase feature changes into the first-phase shell.

## Verification and completion gates

- Meaningful RED/GREEN for new layout behavior; preserve existing UI/contract regressions. Run UI/contracts/typecheck, production build and bounded artifact audit. Do not run local full/cloud/DB suites or import destructive cloud test helpers.
- Same-window checks at 1240x820, 1366x768, 1440x900, 2000x1050, 800x600 and 200% reflow: drag and keyboard resize both handles; shrink during drag; drawer focus/Escape; widen/reload/reset; long content, draft/IME/pending save/project-switch identity, no horizontal overflow/overlap/inaccessible composer.
- Use current shared preview/browser rules; report unavailable tools honestly. Fixture/browser captures do not establish Electron/physical Windows/user acceptance. Native launch/CSP/close-to-tray/pet checks remain held until released; no alternate route around the prior blocked live test.
- Parent independently reviews code/security/accessibility and valid visual/interaction evidence, fixes findings and verifies exact-head CI. User visual approval is required before any UI integration merge. No main/release/deployment or acceptance-ledger promotion.
- Parent receives and acknowledges child result, confirms task_status completed/result_available/no pending children, then archives returned childThreadId. Interrupted/blocked/failed work stays visible; never self-archive or retry previously policy-rejected cleanup.
