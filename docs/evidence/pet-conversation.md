# Local pet conversation

This leaf replaces PR43's contextual message toggle with a separate, focusable conversation window. Clicking the unchanged mouse opens compact chat. Close hides only chat; Expand resizes that same native window and mounted composer. The mouse has only circular Hide and Focus controls. Quiet idle has no bubble, canonical reviewing uses `thinking.....`, and passive speech has no Expand or response controls.

## Custody and ownership

- Assigned checkout: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-8d231d0d`, branch `t3/8d231d0d`. Initial HEAD was `6f43f2bc728bfb7193d1c7c44ab979a1865e048e`, with clean status. It differed from the tool-preparation description; only this clean branch was moved to the explicitly requested PR43 object `74ec9a2b33a70ace1aa5104b9cd4f8815476fa62` before implementation.
- Read the full supplied architecture report and static target. The target is design input, not working-code or acceptance evidence. Candidate author checkout and other checkouts were not modified.
- Changes own the named pet renderer, local contracts/IPC, companion window, preload, bootstrap/build seams, focused tests, and this evidence file. App, WorkspaceRoot, workspace Chat/drafts, board, global styles, cloud/API client, HTTP contracts, dependencies, approved art, pet-mouse.css, credentials, journal and build ledger remain unchanged.
- One necessary additional seam: `tests/build-output-audit.test.ts` now includes the new required preload and corresponding fixture counts. This keeps the existing bounded audit meaningful; production audit rules were not loosened.
- No children, main/sibling messages, Electron GUI, server, browser port, provider/model, real text/history, source, database, VM, deployment, watch, merge or self-archive action.

## Implemented boundary

`Pet -> main openChat -> one petChat BrowserWindow -> PetChatBridge -> existing main-owned PlaybooksClient`

The transparent pet host remains 240 × 280 DIP, with its 128px original sprite. The opaque companion chat has a separate preload, exact surface URL, role, sender and main-frame checks. Sandbox, context isolation, navigation/redirect denial, permission denial, popup denial and renderer network-denying CSP remain enforced. Chat receives a bounded strict projection: messages, the current question, revisions, capability state and an opaque owner/project draft namespace. No DesktopBridge, project title, credentials, document/brief/source material or foreign snapshot is exposed.

Chat reads the service directly through main's authenticated client. It does not call workspace `getSnapshot` dispatch, change selectedProject, or change the pin. Main binds a context to the canonical pet project and owner generation. Replacement/revocation destroys the old renderer before any new context. Hide and close invalidate pending callbacks/commands; late reads, receipts and events cannot reopen or retarget it. Snapshot sequence/revision checks prevent read rollback. Manual activation shows/focuses once; service/event completions never focus it. Passive questions do not open chat.

Compact bounds are 360 × 460 DIP; expanded bounds cap at 560 × 640. Pure placement uses the anchor display's work area, negative origins, above/below/side candidates and clamping. Resizing/repositioning chat never writes the pet's saved position. Ordinary Close/Escape/native close keep the renderer mounted, retain drafts and snooze disclosure, and reopen compact. Explicit close can restore mouse focus; invalidation never restores focus. Focus quiets proactive presentation while manual chat remains available. Hide hides both windows; restoration remains through the existing tray, with no invisible Show button. Native close of the now-focusable pet also uses the canonical hidden preference, keeping tray restoration truthful.

## Canonical chat and draft custody

The transcript is the existing project's canonical conversation. Freeform text is sent only through `sendMessage`, with the original operation ID, expected project revision and input. It is never routed to a check-in answer or used to generate a local manager reply. Accepted work is described as accepted, with no invented reply. Unavailable inference disables Send while keeping the local draft editable. Presentation failures retain the validated transcript/question and draft scope with interaction disabled until refresh.

The popup reuses DraftStore/useDraft mechanics with a separate hashed owner/project key, not the workspace composer key. Each edit is persisted; an original pending envelope is durably flushed before dispatch. Ambiguity preserves it across close/reload. Refresh reconciles canonical owner-message operation identity; reconnect/reopen never sends automatically. Explicit retry reuses the exact envelope. An acknowledgement clears only the sent draft generation; typing during sending or storage transactions survives. Storage errors remain visible and block unsafe sends. Quit requests a bounded, exact context/flush-ID acknowledgement after renderer draft flush before destroying the window. A failed or missing acknowledgement blocks teardown.

The optional Question conversation presentation keeps full text and primary responses together in the transcript. `Mark task done` retains the canonical `recorded` payload; `Not yet` retains its existing payload. Snooze is deliberate disclosure and preserves question/date context. Main presents questions through the canonical service even in Focus, validates the presentation receipt, and retains question/project revision, subject revision, eligibility, identity and expiry checks. Ambiguous question retries retain their original operation envelope in the mounted session. Default workspace Question rendering and behavior remain intact.

## Personally run verification

RED was observed before implementation: missing openChat contract, denied popup read role, missing conversation/session/placement modules, and no conversation launcher. Later focused RED/GREEN checks covered quit acknowledgement, unavailable-window controls, slow-read focus, and retaining transcript/draft scope when question presentation fails.

- Focused contracts, all desktop unit/main-harness tests and pet/conversation/question/draft UI regressions: 293 passing tests in 55 files. Exact source/build hashes are in the frozen local review receipt.
- TypeScript `--noEmit`: passing.
- Production build: passing, including the role-specific chat preload. Vite reports a large-chunk warning; no dependency or unrelated bundling refactor was added.
- Bounded production-output audit: passing; it explicitly does not prove secret absence. Audit regression suite: 65 passing tests, including missing-chat-preload rejection and opaque approved asset/font custody.
- Focused changed-file secret/path heuristic and protected-byte checks are recorded in the local receipt. Original PNG SHA256: `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`.
- Impeccable detector ran once: seven advisories (five type sizes, two retained pet colors). The brief asks for readable 15–16px conversation text and the incumbent warm pet palette; DESIGN.md and ignores were not changed.

The bounded inline visual pass used compiled actual React components with injected restricted synthetic bridges, existing fixture transcript text, and unavailable Send. One initial batch and one confirmation were rendered, then shown with html_render. Compact ordinary text, primary responses and composer were visible together. Long text uses the transcript's scroll region. Some asynchronous sample mounts were captured in loading state, so those captures do not establish complete expanded/pet geometry confirmation. The frozen HTML remains an inspection artifact; it does not implement native windows or a backend. Later loading/authority guards do not change the rendered conversation layout. No further visual polishing loop or acceptance promotion was performed.

## Review limits and continuation

Implementation/security/scope review was performed in-thread; there is no independent child review or merge approval. Native Windows keyboard/IME, focus restoration, scaling, work-area/taskbar transitions, high contrast, enlarged text and transparent-margin interception remain untested. Incumbent tray-wide click-through is retained; no hit-testing overhaul was attempted. Local tests and inline synthetic components establish neither live service/provider behavior nor user visual approval.

Parent should review the exact pushed head and frozen local receipt, then perform native and user acceptance in the authorized environment. Keep this PR draft until those gates and independent review are satisfied. Parent owns acknowledgement/completed-result verification and recoverable child-thread archiving; this implementation did not self-archive.
