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

The existing mouse controls a speech bubble with a tail pointing toward it. The visible manager/project heading is removed. Manager and state identity remain on the accessible sprite. The speech icon, button tooltip and expanded state expose the mouse's control affordance; native Enter/Space activation and Escape closing work. Focus returns to the mouse.

Opening takes 180ms; closing takes 130ms. A cleanup-backed timer settles each transition even without animation events and cancels obsolete exits on reopen. OS reduced motion and canonical preference reducedMotion settle immediately; CSS also suppresses the motion. The bubble stays mounted to retain Question draft/busy state. Closing immediately makes it inert, aria-hidden and disables the fieldset; settled closing also sets hidden. Canonical events and pending requests continue while closed.

The 128px approved sprite remains unchanged. At 240x280, idle controls fit at 14px with 44px action targets. The speech body is deliberately capped at 118px with native scroll and a focusable labeled region so long questions and all controls remain reachable. No presentation action changes preferences or manufactures a canonical answer. Existing schema validation, revisions, replay handling, question eligibility and late-result guards remain in place.

## RED / GREEN

- Offline frozen install: `pnpm install --offline --frozen-lockfile --ignore-scripts`; 266 packages reused, zero downloaded. No lock or manifest changes.
- Initial test harness lacked required demoTiming and was corrected before treating failures as RED evidence.
- Meaningful RED: `pnpm exec vitest run tests/ui/pet-speech.test.tsx` gave 6 failures: visible Nemo heading and absent open/close affordance/transition behavior.
- First implementation: new tests passed; original suite failed only the removed heading assertion.
- Final GREEN: `pnpm exec vitest run tests/ui/pet.test.tsx tests/ui/pet-speech.test.tsx`: 2 files, 16 tests passed.
- `pnpm typecheck`: exit 0. `git diff --check`: exit 0.
- Tests cover heading removal, mouse identity, exit retention and settle, inert/disabled closed contents, focus return, retained draft, OS and preference reduced motion, rapid reopen, in-flight answer busy state, replay/stale revision fences, real keyboard activation/tab exclusion, and late answer after presentation replacement. Existing restricted open/hide/focus/answer/snooze tests remain green.
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
- It bundles the actual Pet component, Question and schema validation using installed esbuild and the original local asset. An explicit synthetic bridge/controller supplies idle, question, long question, hidden, focus and reduced-motion samples and reports synthetic actions. There is no production fixture fallback, remote import or live action.
- Source/build helpers are alongside it, ignored locally via this worktree's info/exclude. No preview server, port, native GUI, competing workspace preview or background process was created. These review artifacts are intentionally retained for the parent, not committed.
- Inline review exceeded the tool's 512KB cap; the smaller copy compresses the same component bundle and uses the original local image path. The inline-only stylesheet substitutes 280px for 100dvh because the auto-sized preview tool rejects viewport height units. Full offline artifact retains production CSS.
- Bounded html_preview capture found a global CSS import-order collision. Scoped specificity fixed it without editing shared styles. Final 420px review capture contains the actual 240x280 pet boundary, idle controls fitting, approved mouse and tail, no console messages. html_render displayed the sample review in this sidechat. Interactive controller exposes longer content for parent/user review.
- jsdom tests do not establish browser layout, native focus/inert behavior, transparent-window hit testing, physical DPI or native acceptance. The synthetic browser capture does not establish desktop preload/IPC or production/native behavior.
- No full/cloud/model-entry suite, production web build, live provider, DB, server, resource markers, held-root or credential access. No independent delegate review because this brief forbids children. Parent must independently review code and visuals; no acceptance promotion, watch, merge or self-archive.

## Asset receipt

`assets/pet/pixel-mouse-idle-v1.png`: 960766 bytes; SHA256 `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e` (matches supplied baseline). Asset and pet-mouse animation source unmodified.
