# Compact visual workspace implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the owned task. No nested agents. The parent owns integration and independent review.

**Goal:** Replace the rejected text-heavy project page with an original, visual project workspace whose overall state is understandable without desktop page scrolling.

**Architecture:** Three agents work in parallel in the already isolated UI checkout, with disjoint source/test/style ownership. Keep the existing React state, trusted panel contracts, durable drafts, request identity and revision/consent fences. The parent owns the git index, commits, integration checks, review, PR and preview. Workers must not commit or change branches.

**Tech stack:** Existing React DOM, TypeScript, Vite and Electron; existing icons authored as SVG, CSS and the approved local mouse sprite. No dependency, cloud or native runtime changes.

**Spec:** The design contract below, grounded in the user's reference and explicit rejection. The previous DESIGN.md and PR33 appearance are rejected evidence, not visual authority.

## Design contract

- Reference board: `C:/Users/user/.t3/userdata/attachments/96c36492-9efa-4b42-98a0-0f15c97a3317-c616f67b-6b96-435a-85ed-c366ea13c063.png`.
- Rejected actual screen: `C:/Users/user/.t3/userdata/attachments/96c36492-9efa-4b42-98a0-0f15c97a3317-d7d4612e-b126-4d09-b0c1-ce50e86e2c10.png`.
- Study both images before implementation. The reference establishes the quality of hierarchy, density, visual information and controls; build an original composition rather than duplicating it exactly.
- Primary scene: a nontechnical person opens a project and can identify progress, the next useful action, its steps, tasks/files/notes, and manager at a glance.
- Desktop frame: a compact header, approximately 200px project sidebar, flexible main desk, and approximately 290px manager. Fit the whole overview at **1366x768 and 1440x900** at 100% zoom. Use screen area deliberately; no tall stack of padded sections.
- Main desk composition: concise project identity; visual actual-task progress with status counts; a prominent next-action card; a connected step tracker; compact task and files/notes cards. Check-ins remain visible/actionable in a compact form. Use original iconography, status chips, outlined/inset panels, designed blue controls and clearly green recorded progress.
- Main page and app frame have no desktop vertical overflow in the normal reference scenario. Every overview region and manager composer has a nonzero bounding box within the viewport. Long collections may scroll within their own clearly bounded list; long notes, source/privacy and settings open in a detail surface. Do not hide or clip actionable content to fake a no-scroll result.
- Readability: body/control text approximately 14-16px; no tiny text, scaling down the whole app or clipping to manufacture fit. Maintain clear focus and keyboard operation. Desktop is the primary design target; mobile uses purposeful view switching, not a squeezed desktop.
- Remove filler such as "One project. Clear steps. A little help along the way." Short labels and concise instructions only. Replace technical owner/revision/provider/fixture language in the main view with everyday wording; retain important diagnostics in reachable details.
- Design controls intentionally: clear primary/secondary/icon actions, custom styled selects and status chips, compact fields, contextual drawers/dialogs. Keep real button/input semantics, labels, keyboard behavior and disabled/loading states.
- AI unavailability is one compact truthful state, not a column of repeated explanations. Drafting stays usable. No invented AI replies or provider readiness.
- Existing sample mode may have a richer **explicitly labeled demo-only** project to demonstrate the whole layout. It must use existing validated fixture APIs and stay behind the existing explicit development/fixture opt-in. No auto demo fallback and no production data fabrication. Prefer a small "Demo" badge with plain explanation available on demand over a diagnostic sentence across the header.
- No unsupported nav destinations, share/export actions, charts, deadlines, accounts or integrations. All counts and progress derive from supplied project records. Unknown progress remains unknown. Files shown must open a real existing document/evidence detail, not a dead visual row.
- Approved PNG bytes remain exact SHA256 `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`; no new stock/generative asset needed. The separate desktop pet and its light theme remain intact.

## Shared implementation contract

- Work only in `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-60c682d9`, branch `t3/living-playbooks-onboarding-ui`, current code head `7bbc10faecb57e8d39bf1b68556823b1822124e4` plus this plan. Do not touch root checkout, create worktrees, switch/rebase branches or stage/commit/push. You are not alone; preserve other workers' changes.
- A owns shared tokens, app frame and global stylesheet. B uses a new `manager-panel.css` scoped under `.app-shell .manager-desk`; C uses a new `compact-details.css` scoped under `.app-shell`. B/C do not edit shared CSS, App or Presentation.
- Reuse shared token names: `--surface`, `--chrome`, `--raised`, `--selected`, `--ink`, `--muted`, `--line`, `--control-line`, `--focus`, `--action`, `--success`, `--error`. Shared base controls apply only to the app as needed, and preserve light pet hover/pressed colors.
- Existing Chat props stay supported. B may add optional `fixture?: boolean`, `openTask?: (id: string) => void`, and `updateTask?: (id: string, status: TaskStatus) => void`; A supplies these through existing guarded actions. B owns Chat's internal wrapper and layout. No new direct API writes in B.
- C adds optional `compact?: boolean` to Question and DocumentEditor, default **false**. A opts into compact mode in App. The native pet keeps default Question behavior. Preserve a single mounted document editor/draft instance when a detail surface opens/closes or the overview changes.
- C keeps SourceControls' existing signature and `id="source-privacy"` disclosure contract, so A's direct shortcut still opens/focuses it. Stop/revoke remain easy to reach.
- A maintains existing `AppIcon` and `ManagerMouse` exports used by B. New icon names can be added, but existing names keep working. ManagerMouse remains the approved sprite.
- Cross-file changes outside ownership are requests to the parent, not permission to edit. Report the exact required interface change promptly.
- All workers use **Impeccable** and **UI/UX Pro Max**. Read both SKILL.md files, run context once against the owned source, read craft-floor before UI edits and use targeted UX/style searches. Actual stack is React DOM/Electron; do not migrate to React Native. The user has already fixed the direction, so no new concept lottery or confirmation is needed.

## Global constraints

- No DB/provider/network-source/native GUI/deployment operations, credentials or owner grants. Railway remains on HOLD; source export and live model remain off.
- No changes to cloud, desktop, contracts, API-client behavior, manifests/lockfile, pet source/CSS/PNG, live acceptance harnesses or CI.
- Existing tickets, request replay, drafts, project switching, revision conflict handling, canonical questions, trusted layout validation, consent and source stop/revoke semantics are protected.
- Each worker performs focused behavior checks, reports scope of evidence honestly and returns owned-file list plus outstanding integration concerns. No nested agents and no independent PRs for this one coherent replacement; parent updates the existing focused PR after review.
- The parent runs the single integrated initial screenshot batch and at most one correction/confirmation batch. Workers may do focused headless behavioral/CSS checks but do not start independent screenshot/visual-polish loops or use the user's browser/native app.

## Review focus

1. Normal 1366x768/1440x900 project: all overview regions, check-in and manager composer visible; no main-page scroll.
2. Realistic long titles, six-plus tasks and long notes: overview stays legible; bounded lists and detail surfaces remain usable.
3. Switching project/overview or closing notes during an in-flight save/reply: draft and canonical identities remain protected.
4. Empty, loading, offline, no-model and unknown-progress states: concise, truthful and navigable, with no unsupported actions.
5. Keyboard, 200% text, reduced motion, source withdrawal and default native pet Question: readable and operable; responsive reflow may scroll where accessibility requires it rather than clip controls.

## Task A: Project workspace and visual system

**Owner files:** `apps/web/src/app/App.tsx`, `WorkspaceRoot.tsx`, `Presentation.tsx`, new app presentation components/styles, `apps/web/src/styles.css`, `packages/project-ui/src/WorkspaceCatalog.tsx`; `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, surface briefs; existing `tests/ui/{onboarding,onboarding-harness,catalog,workspace,states,pairing,project-switch,review-regressions,question-inbox,open-project}.test.tsx` as applicable plus new desk-specific tests. A alone owns changes to existing shared UI tests. A may add app-local explicit-demo fixture data and minimally wire it behind the existing runtime opt-in, preserving its guards and testing them.

- [ ] Read both images, skills, actual state/rendering code and protected asynchronous behavior.
- [ ] Record the desktop region heights and file/interface plan before edits; send a brief early update to the parent.
- [ ] Write meaningful failing checks for view/navigation and data-driven progress; retain existing async/consent/recovery assertions.
- [ ] Build the complete compact frame, visual summary, next action, steps, task/evidence cards, overview and polished create form. Wire C compact props and B optional callbacks without changing guarded command behavior.
- [ ] Preserve editor mounting and trust validation; keep actual detail surfaces reachable. Remove rejected filler, diagnostic copy and the long-page layout.
- [ ] Verify targeted behavior; report any tests temporarily blocked by B/C interfaces. Update design docs to the actual approved direction, not the rejected page.
- [ ] Return owned file list and region map; do not stage or commit.

## Task B: Mouse-led manager and compact chat

**Owner files:** `apps/web/src/features/chat/Chat.tsx`, new manager presentation components and `manager-panel.css`; new `tests/ui/manager-panel.test.tsx` only. Do not edit App, Presentation, global CSS or existing shared tests.

- [ ] Study the reference manager, then read draft/send recovery code and both requested skills.
- [ ] Test real derived task summary, available/unavailable chat, optional quick-action callbacks and draft retention/error behavior.
- [ ] Build a polished compact manager with a visible approved mouse, concise actual progress/next action, useful real quick actions and an anchored composer.
- [ ] Use one quiet availability indicator; remove repeated paragraphs and diagnostic sample messages from preview presentation without inventing model activity.
- [ ] Keep commands revision-safe by invoking supplied callbacks; keep current draft/save fences and actual Send enablement. No dead buttons.
- [ ] Verify normal, long-content, unavailable/offline and keyboard behavior using focused tests, without a screenshot loop.
- [ ] Return file list, callback contract and verification; do not stage or commit.

## Task C: Compact check-ins, notes and privacy details

**Owner files:** `apps/web/src/features/checkins/Question.tsx`, `features/documents/DocumentEditor.tsx`, `features/sources/SourceControls.tsx`, new `apps/web/src/features/compact-details.css` and feature-local helper components; new `tests/ui/compact-details.test.tsx` and existing `tests/ui/sources.test.tsx` only.

- [ ] Read both images, skills and current revision/consent/draft behavior.
- [ ] Add focused checks for compact/default Question, note open/close/draft retention, keyboard/focus restoration and reachable source withdrawal.
- [ ] Add opt-in compact question and document presentation, preserving default pet behavior. Main notes are a visual preview/open action; the full editor lives in a reachable detail surface, stays mounted and retains its dirty/conflict state.
- [ ] Put snooze settings and longer diagnostics in deliberate details; keep the question and main answer actions visible. Style controls/cards to the shared system rather than the browser's default appearance.
- [ ] Keep SourceControls' disclosure/id/permissions intact and ensure pause/revoke remain directly discoverable from the parent shortcut.
- [ ] Run focused tests including default pet Question behavior; send A the exact trigger/prop interface through the parent.
- [ ] Return file list, interface and verification; do not stage or commit.

## Parent integration and acceptance

- [ ] Receive all three results and confirm no overlapping owned-file edits; preserve failed/unfinished work visibly.
- [ ] Integrate interface corrections, run the full UI suite, typecheck, full app build and artifact audit. Check protected paths and approved asset digest.
- [ ] Capture ordinary viewport screenshots at 1366x768 and 1440x900, plus overview, first use, mobile and text scaling in one batched pass. Record desktop region bounds and document/body overflow. Never substitute full-page screenshots for the no-scroll acceptance gate.
- [ ] Compare the actual reference and candidate side by side for visual information, density, control craft, hierarchy and plain copy. A technically green but visually weak implementation fails this review.
- [ ] Apply one batch of concrete corrections, with at most one confirmation pass. Run fresh independent code and visual reviews after workers complete.
- [ ] Commit only the coherent replacement, update the focused PR and link every stack layer. Keep it held until real checks and visual review are satisfied; native/live acceptance remains separate.
- [ ] Make the verified preview available, send exact leaf/evidence to main, and keep Railway/native work unchanged.
- [ ] For each T3 child: receive and acknowledge final result, confirm `completed`, `result_available`, `hasPendingChildRuns: false` through `task_status`, then recoverably archive the returned child thread. Keep unfinished children visible.
