# Compact project desk

Mode: Operate. Binding direction: docs/superpowers/plans/2026-11-07-visual-workspace-rebuild.md and supplied reference/rejection images. The prior spacious long-page DESIGN.md was rejected evidence.

THESIS: Understand the real project and act from one desktop view.
OWN-WORLD: Crisp charcoal panels, blue controls, green recorded task progress, authored consistent outline icons, and the unchanged grey pixel mouse. Original composition; supported actions and supplied records only.
FIRST VIEWPORT: 56px header / 200px project rail / flexible desk / 290px manager. Identity, progress plus review, next action, connected steps, lower task/evidence/notes cards, full-width check-in and manager composer. Tasks and evidence/notes have bounded lists. No clipping of controls or whole-app scaling.
FORM: Real native semantic controls and visible keyboard focus. Details hold long notes, evidence, settings and privacy. Narrow surfaces switch Projects / Workspace / Chat; text scaling may reflow and scroll.

B owns manager internals with .manager-desk and padding. C owns compact Question/DocumentEditor with default=false plus the source disclosure. App opts into compact=true, passes guarded manager callbacks and keeps the editor mounted through detail open/close and overview navigation. Canonical questions remain reachable even without a layout card.

Parent owns initial batched 1366x768/1440x900/mobile/text-scale capture, at most one correction batch, independent review and integration. No worker screenshot loops. DOM and focused CSS checks are not visual acceptance. No native/model/source-read/deployment acceptance is inferred.
