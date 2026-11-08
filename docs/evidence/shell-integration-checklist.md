# Desktop shell integration checklist

Preparation for draft PR40, based on integration `f04fa8a03fb6a212388182fd29825843f3f23638` and approved-plan commit `1bc49ade09499f46fe048546ad202a5e0ee1efc4`. This records source constraints and checks to execute after composition. It is not a renderer, native or visual acceptance receipt.

## Composition and custody

- `apps/web/src/app/WorkspaceRoot.tsx` owns runtime selection and a single draft-store instance. Keep these outside responsive layout state. Pairing must still validate capabilities and canonical confirmation before mounting the workspace.
- `apps/web/src/app/App.tsx` owns selection, request tickets, flush-before-switch, active-snapshot authority, held documents and explicit arrangement application. Preserve these fences when replacing its return tree.
- Keep the same document editor and chat component instances at stable React positions through desktop/drawer transitions. Preserve the document `Fragment` key and Chat's project key. A breakpoint must not simulate selecting a project, change editor keys, flush drafts or apply an incoming arrangement.
- One Resizable group owns desktop widths. The controller supplies preferred/effective pixel widths and drawer state; convert sizes at this seam using the installed library's verified API. Persist only a deliberate user resize, never an automatic layout notification from shrinking the window.
- Keep separators outside the workspace's captured editing events. Preserve the workspace skip-link target. If a transition hides the focused pane, move focus to its visible opener; ordinary resizing must not steal editor focus.
- Render each sidebar once. Confirm that the adapted Sheet/Portal approach retains the actual DOM nodes across mode changes, not just a copy of their React props. Use one active modal drawer, Escape/backdrop dismissal and opener focus return; inactive panes must not remain keyboard reachable.

## Style retirement and scroll ownership

- `apps/web/src/styles.css` currently mixes shared form/type rules, workspace layout and pet rules. It is imported for both entry surfaces by `main.tsx`. Retire the old workspace tracks, tabs and responsive overrides when the new shell lands; do not stack a second layout over them.
- Scope incumbent shared rules needed by the pet to the pet surface while preserving their existing values. Keep pet typography, control metrics, hover/pressed colors, bubble geometry, reduced motion and original PNG unchanged. Pairing/unavailable screens need explicit workspace styling rather than inheriting a removed reset.
- Apply the new black theme and local font only within `.workspace-ui`, including any portal container. Tailwind utilities must not introduce global Preflight or restyle the pet. Do not force the entire document to workspace font/size/colors.
- Projects: identity/filter and actions stay reachable; only the project list needs primary scrolling. Workspace: one primary content scroll owner. Manager: message history scrolls above a stationary composer. Avoid nested whole-pane scrolling and guessed viewport heights.
- Test long task/project names, content-rich notes, large message histories and error banners. The center's minimum is 480 CSS pixels in desktop mode; below 1100 CSS pixels drawers preserve the visible workspace. Height changes must not trigger an oversized document layout.

## Existing behavior to retain

| Source regression | Protected behavior |
| --- | --- |
| `tests/ui/drafts.test.tsx` | Notes/chat persistence, conflict recovery, focus/editor identity, typing during save, failed-storage switch fence |
| `tests/ui/review-regressions.test.tsx` | Late A→B→A save/send responses, held replacement editor, exact creation replay, task opening without a checklist target |
| `tests/ui/project-switch.test.tsx` | Stale snapshot and project-switch response fences |
| `tests/ui/open-project.test.tsx` | Trusted desktop navigation and flush failure |
| `tests/ui/pairing.test.tsx` | No premature client construction or stale destination confirmation |
| `tests/ui/pet.test.tsx` | Restricted pet state, events, controls and original mouse behavior |

Phase one retains the existing owner-action payloads, revision checks and source-consent controls. Phase-two task checkbox/details/next-action/check-in semantics remain outside this checkpoint. Move privacy and withdrawal presentation into accessible settings without removing the operations or turning local withdrawal into a cloud-dependent action.

## Checks after both implementation leaves are joined

- Composition tests: same editor/composer DOM identity and text through narrow/wide changes; a pending save/send does not acknowledge a newer draft; one drawer at a time; Escape/backdrop/focus return; no keyboard access to a closed pane; settings and project creation remain reachable.
- Controller tests cover measurement/storage/clamping. Browser interaction must additionally cover both real library handles with pointer and keyboard, cancellation during resize, shrink during drag, width restoration after widening, reload and reset. A mocked ResizeObserver or a screenshot alone cannot prove this.
- Continuously resize the same renderer at 1240×820, 1366×768, 1440×900, 2000×1050 and 800×600, including 200% text/reflow. Check horizontal document overflow, overlap, independent scrolling, long labels and the composer. State the usable viewport dimensions separately from native window outer dimensions.
- Run `pnpm test:ui`, `pnpm test:contracts`, `pnpm typecheck`, `pnpm build`, `pnpm exec tsx --test tests/build-output-audit.test.ts` and `pnpm exec tsx scripts/audit-build-output.ts` in this candidate checkout. Review the resulting quiescent manifest and exact font/mouse bytes. Do not import local DB/full-suite helpers or private environment files.
- `apps/web/index.html` retains the production meta CSP with `connect-src 'none'` and no inline-script allowance. Vite's development-only transformation does not establish packaged compatibility. Inspect actual emitted styles/font URLs and library style insertion without weakening CSP.
- `apps/desktop/src/main/native-windows.ts` already retains the Windows title bar and 1240×820 default / 800×600 minimum. Its response CSP and the renderer meta policy both matter. No native source change or native launch is authorized by this preparation.
- Do not run `tests/ui/release-check.mjs` unchanged: it creates a server on hard-coded port 5181, used by an earlier review surface. Check current ownership before selecting a dedicated renderer port and use the shared-browser workflow when that verification step is reached; do not stop another owner's preview.
- Independent code/accessibility/visual review and user shell approval remain required. Browser fixtures are synthetic renderer evidence only; native Windows, live workflows and release acceptance stay open. PR33 remains unaccepted; the held root and all live-resource holds remain unchanged.
