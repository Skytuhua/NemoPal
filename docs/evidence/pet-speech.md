# Pet speech redesign evidence

## Custody and scope

- Starting cwd: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-39356067`.
- Starting branch: `t3/39356067`; clean status (no tracked or untracked changes).
- Starting HEAD: `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`.
- Starting tree: `488ad42c00f7277d02af001c2aae37d51b3ca3cf`.
- This prepared checkout contains committed baseline only. The parent shared checkout and its uncommitted edits were not read, copied, or changed. The held Documents checkout was not accessed.
- Files: `apps/web/src/pet/Pet.tsx`, new `apps/web/src/pet/pet-speech.css`, new `tests/ui/pet-speech.test.tsx`, this evidence file, and the permitted one-line migration below.
- No native host, shared styles, Question, contracts, bridge, config, dependencies, sprite CSS or asset changes.

## Behavior

The existing mouse controls contextual speech with a tail pointing toward it. There is no visible manager/project heading or permanent menu in the bubble. Manager and state identity remain on the accessible sprite. The speech icon, tooltip and expanded state expose the mouse's message affordance; native Enter/Space activation and Escape closing work. Focus returns to the mouse. Idle with no meaningful message is quiet and collapsed; its disabled mouse toggle is labeled No new messages. New due questions and meaningful canonical status changes reveal speech; repeated identical events do not reopen it.

Opening takes 180ms; closing takes 130ms. A cleanup-backed timer settles each transition even without animation events and cancels obsolete exits on reopen. OS reduced motion and canonical preference reducedMotion settle immediately; CSS also suppresses the motion. The bubble stays mounted to retain Question draft/busy state. Closing immediately makes it inert, aria-hidden and disables the fieldset; settled closing also sets hidden. Canonical events and pending requests continue while closed.

The 128px approved sprite remains unchanged. Hide is a small minus glyph at the mouse's upper-right edge; Focus uses a distinct crescent glyph with canonical aria-pressed state; Open project uses an external-arrow glyph. These utility buttons live outside speech, have names/tooltips and 44px click/keyboard targets. Canonical hidden state exposes a plus/Show pet restore button and a reachable message toggle. Utilities fit alongside the mouse within 240x280. The speech body is deliberately capped at 114px with native scroll and a focusable labeled region so long questions and all answer/snooze controls remain reachable. No presentation action changes preferences or manufactures a canonical answer. Existing schema validation, revisions, replay handling, question eligibility and late-result guards remain in place.

Canonical reviewing (after existing six-state priority mapping) shows a cloud-shaped thought container with `thinking.....`. This is a status indicator only, with no model transcript or invented live state. Due questions outrank reviewing, and offline, snoozed, focus or hidden states suppress the cloud. Errors use normal speech. One deliberate container switches mode; there are no overlapping bubbles. The dots are static, and existing OS/preference reduced-motion handling covers entrance/exit.

## RED / GREEN

- Offline frozen install: `pnpm install --offline --frozen-lockfile --ignore-scripts`; 266 packages reused, zero downloaded. No lock or manifest changes.
- Initial test harness lacked required demoTiming and was corrected before treating failures as RED evidence.
- Meaningful RED: `pnpm exec vitest run tests/ui/pet-speech.test.tsx` gave 6 failures: visible Nemo heading and absent open/close affordance/transition behavior.
- Refinement RED: quiet idle/outside utilities and due-question reveal each failed before implementation. Thought-mode RED: both canonical reviewing/priority tests failed because thinking text/cloud was absent.
- First implementation: new tests passed; original suite failed only the removed heading assertion.
- Final GREEN: `pnpm exec vitest run tests/ui/pet.test.tsx tests/ui/pet-speech.test.tsx`: 2 files, 21 tests passed.
- `pnpm typecheck`: exit 0. `git diff --check`: exit 0.
- Tests cover heading removal, mouse identity, exit retention and settle, inert/disabled closed contents, focus return, retained draft, OS and preference reduced motion, rapid reopen, in-flight answer busy state, replay/stale revision fences, real keyboard activation/tab exclusion, late answer after presentation replacement, utilities outside speech, quiet idle, canonical hide/focus/restore, question reveal, reviewing cloud entry/exit and higher-priority suppression. Existing restricted open/hide/focus/answer/snooze tests remain green.
- The keyboard regression first timed out with fake timers/user-event; switching that test to real timers plus a fixed Date.now resolved the harness issue.

## Conflict-safe assertion migration

Only `tests/ui/pet.test.tsx:35` changes:

```diff
-  expect(screen.getByText('Second manager')).toBeVisible();
+  expect(screen.getByRole('img', { name: /Second manager/ })).toBeVisible();
```

Apply that single assertion when integrating; do not replace the parent file or its unrelated board assertions.

## Visual artifact and limitations

- Full self-contained offline HTML: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-39356067/.pet-speech-review/pet-speech.html`.
- It bundles the actual Pet component, Question and schema validation using installed esbuild and the original local asset. An explicit synthetic bridge/controller supplies idle, question, long question, reviewing/thinking, milestone, offline, hidden, focus and reduced-motion samples and reports synthetic actions. There is no production fixture fallback, remote import or live action.
- Source/build helpers are alongside it, ignored locally via this worktree's info/exclude. No preview server, port, native GUI, competing workspace preview or background process was created. These review artifacts are intentionally retained for the parent, not committed.
- Inline review exceeded the tool's 512KB cap; the smaller copy compresses the same component bundle and uses the original local image path. The inline-only stylesheet substitutes 280px for 100dvh because the auto-sized preview tool rejects viewport height units. Full offline artifact retains production CSS.
- Bounded html_preview capture found a global CSS import-order collision. Scoped specificity fixed it without editing shared styles. Final refinement captures at 420px contain the actual 240x280 boundary: quiet idle with utilities, a due question, reviewing cloud, and bounded long question, with no console messages. The first overlong synthetic question was correctly rejected by the real 512-character schema limit; it was shortened to five repetitions and recaptured successfully. The original menu capture is superseded by the contextual design. html_render displayed the sample review in this sidechat. Interactive controller exposes longer content and the thinking mode for parent/user review.
- jsdom tests do not establish browser layout, native focus/inert behavior, transparent-window hit testing, physical DPI or native acceptance. The synthetic browser capture does not establish desktop preload/IPC or production/native behavior.
- No full/cloud/model-entry suite, production web build, live provider, DB, server, resource markers, held-root or credential access. No independent delegate review because this brief forbids children. Parent must independently review code and visuals; no acceptance promotion, watch, merge or self-archive.

## Asset receipt

`assets/pet/pixel-mouse-idle-v1.png`: 960766 bytes; SHA256 `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e` (matches supplied baseline). Asset and pet-mouse animation source unmodified.
