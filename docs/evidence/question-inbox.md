# Canonical in-app question fallback

Base: navigation correction PR #8, `1f337fb8b5c1273dc7fe02d0612238e1a29b5c10`. This focused layer stacks on `feat/integration-preflight`; cloud and pairing branches are not included.

Cloud PR #6's independent review found that a newly scheduled canonical question can exist in `snapshot.checkIns` without a generated `question_card`. The old workspace could therefore hide its only in-app answer path when the native bubble was hidden or intentionally suppressed after a crash.

The workspace now renders canonical questions missing from the currently displayed canvas in a trusted Questions section. Existing question-card entries are not duplicated. Both locations use the same existing Question component and revision-checked answer/snooze/cancel handlers. Refreshes retain the question's project ID; late A responses cannot replace B. Closed answers remain visible after reload. No generated panel type, schema, native authority or model call was added; arbitrary question references remain invalid.

Evidence on 2026-11-07:

- Baseline: three new cases failed; the existing-card/no-duplicate case already passed.
- After correction: all four focused cases pass: Recorded and Not yet persist across remount without a card/pet, existing cards are not duplicated, and a delayed A answer preserves B's selected view.
- Full available B/navigation/inbox suite: 40 files / 138 tests passed. TypeScript, Vite web build, evidence checker and diff checks passed. Type-only test query options were corrected without changing production behavior.
- Independent scoped code review: no findings. Static only; reviewer did not run tests or native/visual checks.

These tests use synthetic fixture snapshots and an in-memory draft adapter. They do not prove cloud scheduling, real pairing, actual IndexedDB, native bubble behavior, live source/model integration, or visual acceptance. The cloud owner separately adds canonical check-ins to its read tool and fixes the other cloud findings. A real cloud-to-workspace scheduled-question/answer path remains an integration gate.
