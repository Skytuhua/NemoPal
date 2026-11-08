# Native SCRIPTED check-in acceptance

Source/base: `fe8e940a8837edcd364b722a13a8aec696789ee4`, the head of
`feat/golden-workflow-integration` / PR15 when this lane began. Changes belong only
to `tests/integration/j1-product.ts` and this evidence file. No children were used.

## Contract and attribution

The optional `--checkin` case extends the existing J1 harness. It first runs the
original protected pairing, UI project creation, owner Phase change, renderer
reload and full Electron restart. Default J1 continues to expect zero tasks,
panels and questions, with reminders off.

Only after the real UI creates this synthetic owner's project, a parameterized
transaction locks that owner/project and installs a schema-validated task,
checklist/question panels and one **SCRIPTED canonical question**. Its authority
references the real, unexpired access credential/device created by trusted UI
pairing. No token is read out of protected storage. Task and question text and
panel headings visibly say `SCRIPTED`.

This fixture begins in `scheduled` with a due time one second before installation;
it does not exercise model proposal generation or the proposal scheduler's
five-minute minimum lead time. No job is claimed or committed by the test. The
actual production-cloud dispatcher, real clock, eligibility policy, native main,
preloads, React pet and pet bridge perform admission, presentation and answer.
The test never writes `available`, `presented` or `answered` fixture state.

Reminder consent is enabled only for this synthetic owner. Only that owner's
quiet hours are explicitly disabled with equal endpoints; the default attention
cap of three remains and exactly one authorization is charged. Foreign owner
preferences are untouched. This is an eligible-hours journey, not native proof of
quiet-hour/cap suppression. The existing read-only foreign scheduler preflight
runs before grant/cloud creation and again before fixture installation. A foreign
open question or excerpt blocks dependent work without clearing it.

Both cases use one local cloud and one desktop instance at a time, unique appData
and sessionData set before actual main import, real Windows safeStorage, bounded
native evaluations, and existing owner/process/profile cleanup. Model access,
source selection, export and demo timing stay off. The test does not import DB
suite helpers, migrate, reset/truncate, change dependencies, or operate Railway,
providers, GPU or the user's default application profile.

## Commands and observed proof

Executed on Windows, 2026-11-08 UTC, using Node `24.14.0`, pnpm `10.30.3` and the
installed Electron `45.2.3` dependency. The parent explicitly released exclusive
`127.0.0.1:55432/playbooks_test` ownership before this lane connected. Credentials
were supplied only by Node's env-file loader; the env file was never opened or
printed.

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=C:/Users/user/Documents/NemoPlaybook/.env --import tsx tests/integration/j1-product.ts --db-released
node --env-file=C:/Users/user/Documents/NemoPlaybook/.env --import tsx tests/integration/j1-product.ts --db-released --checkin
pnpm typecheck
pnpm exec vitest run tests/cloud/checkin-policy.test.ts tests/desktop/presentation.test.ts tests/ui/pet.test.tsx tests/ui/question-inbox.test.tsx
git diff --check
```

Frozen install and production build passed. Default J1 passed, exit 0, with all
original boolean receipts true, including protected storage, pairing, persistence,
reload, native restart and all cleanup. Typecheck passed. The four supplemental
non-DB policy/presentation/React files passed: **14 tests**. Diff whitespace and
unchanged production/package/dependency path checks passed. No full DB suite or
hosted CI was run. The unflagged release-guard invocation reported BLOCKED at
preflight without DB connection; the terminal wrapper reported exit 1 despite
the script assigning the intended blocked exit code 2, so an observed exit 2 is
not claimed here.

Final scripted native receipt, exit 0:

```json
{"result":"PASS","stage":"complete","uniqueSyntheticOwner":true,"productionCloudReady":true,"actualMainProfileIsolated":true,"nativeProtectedStorageAvailable":true,"trustedUiPairing":true,"uiCreateMatchesSavedSnapshot":true,"uiOwnerChangeSaved":true,"rendererReloadReadsSavedState":true,"fullProcessRestartRestoresProtectedCredentialAndSavedState":true,"scriptedCanonicalFixtureOnly":true,"actualSchedulerAdmittedAndNativePetPresented":true,"actualPetAnswerSavedSameCheckInAndTask":true,"answeredRestartReconnectNoLogicalRepeat":true,"modelSourceExportDemoOffSyntheticRemindersOnly":true,"ownedProcessesStopped":true,"syntheticOwnerRemoved":true,"isolatedProfileRemoved":true}
```

Assertions observe `scheduled` revision 0 becoming `presented` revision 2 through
the real dispatcher and native presentation acknowledgement. The visible,
always-on-top product pet displays the SCRIPTED question in `waiting_for_you`.
Clicking its actual **Recorded** button saves `answered` revision 3 with the same
check-in and presentation IDs. The task becomes `done`, revision 1,
`user_reported`, with owner override and no source evidence. The workspace renders
the saved answer, task status and owner attribution.

Renderer reload, a different Electron process, another renderer reconnect and an
additional 16-second observation window preserve the complete canonical answer.
Exactly one check-in, one account presentation authorization and one local journal
presentation remain; the pet is idle with no question/Recorded control. The
model-usage counters remain unchanged and source bindings, observations, journal
entries/uploads/source commands remain empty. No controlled HTML, mocked bridge,
dialog mock, screenshots or traces were used for acceptance.

## Startup-dialog incident and limits

An initial typecheck rejected a test-only call to an unavailable Electron
inspection API; it was removed. The first scripted native attempt reached the
real scheduler, pet Recorded answer, saved task/workspace and renderer reconnect,
then failed at `answered-native-restart` with an assertion failure. Cleanup
required the native-close fallback and reported owned process, synthetic owner
and isolated profile removal successful. A test assertion had checked native
visibility immediately after observing the window; the final harness instead
waits for actual native visibility. The next scripted run passed completely.
These harness failures are not presented as product RED evidence.

The parent subsequently supplied a screenshot of actual main's generic
`Living Playbooks blocked` / `Native startup failed` dialog. Its attachment
timestamp was `2026-11-08T01:09:08.033Z`. The parent identified a scoped Electron
45.2.3 tree (main PID 49596, children 36544/58888/556/50464) associated with
`lp-j1-product-bZ8CIv`, not the default AppData profile. The reported launch layout
was the unique temp root's `launcher.mjs`, importing this checkout's compiled
`apps/desktop/dist/main/index.js`; userData was its
`app-data/LivingPlaybooks`, with separate `session-data`.

On receiving the incident steering, repeated native launches were paused. The
in-flight final run had already completed PASS and cleanup. A direct check of all
five supplied PIDs found none alive; the exact reported temp root, journal and
`.previous` were absent. No broad process kill, journal clearing or default-profile
access followed. The random launcher suffix was not logged by the original
harness; the concrete suffix above comes from the parent's process metadata.

Confirmed sanitized category: **actual main startup promise rejected**. The
generic production guard hides the finer cause. Close-during-startup caused by
the initial visibility assertion is a hypothesis, not a recovered diagnosis. No
diagnostic bundle or additional launch was made, and no remaining uncertain
profile was available to preserve. The successful later run does not explain
away this incident; parent review should assess it before acceptance/merge.

The lane explicitly **RELEASED the dedicated DB** after successful cleanup and
will make no further DB/native run. The parent may reuse it. The separately
reported hosted Nemotron probe belongs to the parent and is not this test's
evidence. Live model/source J4, snooze, cloud-process restart, packaging,
deployment and user visual acceptance remain unproved. No watch, merge or
self-archive is performed; fresh parent review is pending.

## SHA-256 custody

The final scripted PASS and typecheck exercised harness SHA
`1a0241deb92e8d0558d35b9713499ecee0ca23addc52bd573198f72aeb15009e`.
The separate default J1 PASS used
`fb34cfbcc3a34028d39efea89b120b2fe63c1f0cc1e4d11d473edd444ceda079`;
subsequent changes only add readiness waiting/stage markers inside `--checkin`.
The original default behavior was not rerun after the native pause.

| Source/runtime artifact | SHA-256 |
| --- | --- |
| `tests/integration/j1-safety.ts` (unchanged) | `087ae98bfaf3be468f1b407c8e73d0dfb7c49aba79214530461caba5a23f99e1` |
| `apps/cloud/src/checkins/scheduler.ts` | `f8b27683ff0335afc41c0073cfb5b98d20f460c52b751d967c9cc614632d8398` |
| `apps/cloud/dist/main.js` | `c1243335dac8fa9c8caf787aecc2752d744c099648eff60291087fd009edba8f` |
| `apps/desktop/src/main/index.ts` | `efdc17924c174256d38ce24edbf783dacc2bc333f5ba578f8e6cdcf99b1c96a9` |
| `apps/desktop/dist/main/index.js` | `5e006f4d184efd17ad71e9c90f5cc928b1580ef0019a14b4d6b23f8e8c47550e` |
| `apps/desktop/dist/preload/workspace.cjs` | `8aa6e82b2c3186e40a203725ce21c4523425268a9dd12a1ddfa81de8a10f8fd1` |
| `apps/desktop/dist/preload/pet.cjs` | `abf71d1f608a5ee94f49afb5659cd877841eb5f467575be7b4529406775d2693` |
| `apps/web/src/pet/Pet.tsx` | `d3fdfb7cfac5f969374d233325140b48cfd776b6826fb2cbd61dbe18bea2296f` |
| `apps/web/dist/index.html` | `619a0b2909cd3a17bb68fc0897c2567af9a2548c9320b364a3ef5a0804cc91dc` |
| `apps/web/dist/assets/index-BlKlPGqn.js` | `65696fc7b87614d4d304a89cc9fec9a13a703523e1709b4b752c833aaafa7f2e` |
