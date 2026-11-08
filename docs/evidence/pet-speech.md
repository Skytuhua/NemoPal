# Pet compact popup evidence

## Custody

- Follow-up starting cwd: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-39356067`.
- Branch: `t3/39356067`; clean at follow-up start.
- Exact follow-up starting HEAD: `4c7897ba82904db80390829fe7cf3ea6ddafdd8f`; tree `63754b85e691f8c8c64d014b7251def1c733aba9`.
- Original prepared baseline: `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`, clean; tree `488ad42c00f7277d02af001c2aae37d51b3ca3cf`.
- Only the owned isolated checkout was edited. No main-session messages, agents, parent dirty files, held Documents checkout, new checkout, child, native launch, server or port use.
- Files: `apps/web/src/pet/Pet.tsx`, `apps/web/src/pet/pet-speech.css`, `apps/web/src/features/checkins/Question.tsx` (newly authorized optional compact variant), `tests/ui/pet-speech.test.tsx`, minimal migration in `tests/ui/pet.test.tsx`, and this document.

## Final behavior

The approved mouse itself is always the click/Enter/Space message toggle, including quiet idle. It opens a compact contextual popup; there is no overlaid chat glyph or external expand arrow, visible title, manager heading, filler message, or pretend mini-chat composer. Expand is at the popup upper-right, labeled Expand to project chat, and invokes the existing restricted `openProject` command for the full project workspace/manager chat. This does not invent a private resize API or claim chat-input focus.

Only Hide/Show (minus/plus) and Focus (crescent) remain beside the mouse, in separate opaque circular controls. Both have names/tooltips, keyboard focus, 44px nonoverlapping targets and an 8px gap. Canonical state controls hidden/focus/pressed appearance; no optimistic preferences. On canonical hidden, all artwork, message popup, Focus and mouse controls disappear; only the plus/Show pet restore control remains. The old Pet hidden announcement is removed. Offline displays the requested sleeping emoji with accessible Cloud offline identity; the old long offline sentence is removed. The canonical offline sprite state remains offline.

One contextual container switches between speech and the cloud-shaped `thinking.....` indicator for canonical reviewing. Due questions, offline, snoozed, focus and hidden state retain their existing priority. No hidden reasoning, transcript, live model state or invented production reply is shown. New meaningful desktop changes can reveal the message; identical/replayed/stale events retain the existing fences.

Opening is 180ms and closing 130ms. Cleanup-backed timers cancel obsolete exits and settle without animation events. OS and canonical preference reduced motion settle without spatial movement. Manual closing retains the mounted Question and its date/view/busy state, makes the popup inert and aria-hidden immediately, disables the fieldset and Expand, then sets hidden when settled. Closing returns focus to the mouse. Hidden canonical state suppresses the popup immediately. An empty idle popup body is not a tab stop.

## Compact Question, default preserved

The optional `compact` prop defaults to false. Full workspace Question retains its existing normal state caption, immediate date/snooze form, cancel/open-task controls, busy/error text, answer handling and future-date/timezone payload logic. The small shared submitSnooze function contains the original date validation and payload; business logic is not duplicated.

Pet primary view omits only redundant normal Question available/presented metadata. It shows the ordinary question and both response buttons, plus a labeled clock/Snooze options action. Snooze is a separate deliberate view with Back, a labeled native datetime input and Snooze question. Back/Escape return to answers and restore focus; date drafts survive Back, popup close and reopen. Saving/error feedback occupies the primary text area rather than pushing the responses out of the frame. Important expired/answered feedback is retained by the compact Question variant.

Long questions use an explicit Read full question disclosure. Text that exceeds the preview's actual measured height also switches to that disclosure, including enlarged text. Full text is in a labeled, keyboard-focusable bounded scroll view with Back to answers. Demo reminder timing remains in primary view; secondary read/snooze views temporarily omit that presentation marker and restore it on Back. Notifications and canonical event state are not deleted to fit the layout.

## Verification

- Existing own offline dependencies reused. The original install was `pnpm install --offline --frozen-lockfile --ignore-scripts`, with zero downloads; no dependency, lock, configuration or asset changes.
- Meaningful follow-up RED: three new regressions failed on the existing caption, disabled idle mouse and absent snooze navigation. The idle empty-region tab-stop regression also failed before its one-line fix.
- Final GREEN: `pnpm exec vitest run tests/ui/pet.test.tsx tests/ui/pet-speech.test.tsx tests/ui/question-inbox.test.tsx`: 3 files, 31 tests passed.
- `pnpm typecheck`: exit 0. `git diff --check`: exit 0.
- Tests retain restricted answer/snooze expectedRevision/payload, replay/stale revision and late-answer fences, canonical preferences, six sprite states, both reduced-motion sources, exit settle/interruption, pending-answer survival, date survival and keyboard exclusion. New coverage includes the compact caption, only two mouse utilities, idle popup/Expand, snooze Back/Escape/focus, default Question preservation, compact expired feedback, overflowing text disclosure and hidden-only restore/offline emoji.

## Actual-component visual and geometry receipts

Current full self-contained HTML: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-39356067/.pet-speech-review/compact-pet.html`.

Inline review HTML: `.pet-speech-review/compact-inline.html` (compressed actual component bundle plus original local asset path, below the inline tool's 512KB cap). The full standalone artifact embeds the approved asset and needs no server/network. Sample code is `.pet-speech-review/grid.tsx`, built with installed esbuild by `grid-build.mjs`. Explicit synthetic bridges validate samples through SafePetEventSchema and record sample actions. None is wired into production.

Two bounded visual rounds were used: initial inspection, then one confirmation. The initial round found enlarged-text overflow and a synthetic harness timing error (secondary-view clicks happened before the parent fieldset became enabled). Both were corrected together. The confirmation shows the actual component in 20 samples: light and dark backdrops, each with idle closed, idle popup open, ordinary question including demo timing, snooze, long-question primary, full read, thought cloud, offline, hidden and 20px body text. Response labels grow from 14px to 17px in the enlarged-text sample and remain fully visible.

Receipt: `.pet-speech-review/geometry-confirmation.json`. The browser reports zero out-of-frame controls in all 20 samples. It measures actual button/input/tabindex rectangles relative to each 240x280 frame, not jsdom's layout mocks. Native dimensions and the 128px sprite are unchanged. Representative measured geometry:

- Mouse button: x56/y148/w128/h128; Hide x192/y164/w44/h44; Focus x192/y216/w44/h44. Utility targets and mouse target have an 8px horizontal gap; utilities have an 8px vertical gap.
- Ordinary question popup: x4/y4/w232/h140. Body x11/y11/w218/h126; scrollHeight/clientHeight both126, including the timing marker, question and complete primary actions. Expand x185/y11/w44/h44.
- Snooze and full-read body: height124, scrollHeight/clientHeight124; all Back/input/submit rectangles stay inside the frame. Full-read prose has its own intentional scroll region.
- Long/20px primary body: height110, scrollHeight/clientHeight110; preview scrollHeight/clientHeight64. Overflowing text is disclosed rather than silently clipped.
- Hidden: only Show pet x192/y164/w44/h44.
- Utility ink `#302d24` on opaque paper `#fffdf5` has calculated contrast 13.51:1, independent of desktop backdrop. Focus outlines are inset to remain inside the native frame.

The preview tool truncates long console control lists; the receipt retains those raw logs and aggregate violation results. After the geometry capture, a nonvisual one-line tab-index correction removed the empty idle body from keyboard traversal, was tested RED/GREEN, and the artifact was rebuilt. Geometry/CSS did not change. html_render displayed the actual-component synthetic review in this sidechat. No additional polishing/capture loop was run.

Old `.pet-speech-review/pet-speech.html`, `inline-compressed.html` and earlier clipped captures are superseded; use compact-pet.html. All review artifacts/helpers/receipts remain locally ignored through this worktree's info/exclude and are intentionally retained for parent review. No server, port, browser tab, native GUI or background resource requires cleanup.

## Conflict-safe original-test migrations

Apply these small edits by context to the parent's dirty `tests/ui/pet.test.tsx`; never replace the whole file:

- Line35 from the original PR: visible Second manager heading assertion becomes `getByRole('img', { name: /Second manager/ })`.
- Line46: the six-state test's generic img query becomes `getByRole('img', { name: /^Nemo/ })`, distinguishing the approved mouse from the new accessible offline emoji.
- Line63: Open project button lookup becomes Expand to project chat; the command assertion remains exactly openProject/projectId.
- Insert Snooze options click before typing Snooze until (now line89); canonical snooze payload assertions remain unchanged.

## Limits and acceptance

PetBridge currently exposes restricted state events plus answer, snooze, setPreference and openProject commands. It has no manager-message subscription or free-form send-message command. Implementing real mini-chat sending would need an explicitly approved bridge/schema/native seam; this patch offers existing status/question conversation and the supported Expand path only.

No full/cloud/model-entry suite, production web build, native/live/provider call, held-root read, credential access, DB, deployment, VM or resource marker operations were performed. jsdom is interaction/state proof; the synthetic browser capture is geometry/visual evidence, not desktop preload/IPC, physical DPI, native transparency/hit-testing or user visual acceptance. OS scaling beyond the explicit 20px body sample remains unverified.

The cancelled old review is not approval. Fresh independent parent code/visual review and user approval remain required. No child, watch, merge, acceptance promotion or self-archive.

## Asset receipt

`assets/pet/pixel-mouse-idle-v1.png`: 960766 bytes; SHA256 `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`, unchanged and matches the supplied baseline. `pet-mouse.css` animation source is unmodified.
