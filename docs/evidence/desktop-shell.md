# Desktop shell checkpoint

The working React/Electron renderer is being rebuilt in draft PR40 against
`feat/golden-workflow-integration`. Reviewed helper PR41 and foundation PR42 are
joined at `72b7f6973ee40189d63ab8b58bd8728663d810db`.

The first composition preserves the existing project/draft/revision fences,
uses the official Resizable group, and retains the same nonmodal, nonportal,
force-mounted Sheet/editor/chat hosts across the 1100px drawer transition.
Custom focus handling supplies background inertness, one drawer, Escape/backdrop
dismissal, focus return and desktop traversal outside Radix's looping scopes.

An independent native read-only helper found two interaction issues: unconditional
imperative layout reset during unrelated renders, and invisible focus guards in
desktop traversal. The parent fenced size application by geometry/preferences and
excluded Radix guards and closed-details descendants. No backend/IPC/auth change
was made. Legacy workspace CSS was retired; pet defaults and original mouse bytes
remain scoped separately. The root test-only browser shim is not production code.

Checks on the first composition:

- Initial composition RED: all four new shell cases failed against the old screen.
- Focused composition GREEN: 5 cases, including edge Tab filtering.
- UI/contracts, excluding the one live-entrypoint contract file: **205/205 PASS**.
- Typecheck, production build, whitespace and bounded artifact audit: **PASS**.
- Audit: 12 files / 6,665,535 bytes; manifest
  `e656db6cfef763e644826460c05bd3633fa2bb83f96640cfe65b244cadf10e6f`.
- Bounded actual Edge headless fixture checks: 1240×820, 1366×768, 1440×900,
  2000×1050, 800×600; real pointer/keyboard resizing; refresh during drag;
  shrink during drag; drawer focus/dismissal; exact editor/composer node identity;
  draft/width reload; reset; and 400×300 CSS reflow. All passed with zero remote
  requests. The latter is not native 200% DPI proof.

The shared preview did not consistently apply requested sizes and animation-frame
evaluation timed out. The bounded local browser fallback was used after those
failures; its ignored script and receipts live under `.tmp/shell-browser*`.
No database, provider, native Electron, source/export, VM or deployment operation
ran. These checks establish renderer fixture behavior only.

**The user rejected this visual checkpoint.** Required follow-up: product name
NemoPal; mouse belongs to the manager, not the app brand; larger section text;
meaningful progress/status visuals; no filler; and a normal desktop overview
without main scrolling. A supplied reference is inspiration only. This receipt
does not grant visual approval. Phase two and any UI integration merge remain held.
