# Source preview setup

This is an unsigned **source preview fallback**, not an installer or a completed
release. Instructions were checked against PR15 source
`f1718a9f1698a32181b594f83b82360f59645f16` on
`feat/golden-workflow-integration`. Use the parent's reviewed integrated revision;
do not substitute an unjoined deployment branch. See [demo status](demo.md) and
[local build receipt](evidence/build-output.md).

## Install and inspect the local build

From the repository root, use Node **24.14.0** (engine range `>=24.14.0 <25`) and
pnpm **10.30.3**, as pinned by `package.json`:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm exec tsx --test tests/build-output-audit.test.ts
pnpm typecheck
pnpm build
pnpm exec tsx scripts/audit-build-output.ts
```

The audit uses only Node built-ins. Run it on the completed, idle build in this
checkout. It takes no arguments and scans only `apps/{cloud,web,desktop}/dist`.
It reports relative paths, exact byte counts, file SHA-256 hashes and a canonical
manifest hash, with `secretAbsenceProven: false`. It rejects missing entries/assets,
unexpected files/directories, links, forbidden names, excessive inventory/size,
invalid UTF-8 text and selected credential formats. The one approved pixel-mouse
PNG is opaque: its exact size and SHA-256 must match the reviewed asset before
it can bypass text decoding. Other PNGs or altered bytes are rejected.
Exit 0 is a bounded output audit
pass; exit 1 is blocked.
No root script or packaging command was added. This top-level Node test is **not
selected by the existing Vitest projects**; run its explicit command above.
CI runs that command separately and audits the completed build. The positive
sprite fixture reads its pinned public Git blob; retain full Git history when
running this fixture, as configured in CI, rather than duplicating the binary.

The pattern and inventory scan is **not proof that no possible secret exists**.
Encoded, unfamiliar, split or arbitrary secrets can evade it. Source maps include
bundled source text; do not distribute the entire checkout, ignored environment,
runtime data or dependency tree as though they were audited release assets.
The scan does not validate an installer, signatures, dependencies, provenance,
native behavior, hosted services or live acceptance. Details and limits are in
the [receipt](evidence/build-output.md).

## Local cloud prerequisite, owned by the operator

The desktop needs a configured authenticated cloud API to use real projects.
The build does not start it or prepare PostgreSQL. The operator must own and
approve the target database and load `DATABASE_URL` privately into the cloud
process environment. Do not paste connection strings into commands, docs,
screenshots or logs, and do not point a test suite at shared/production data.

After confirming the database and reviewed schema revision, the operator's
existing entry points are:

```powershell
# DATABASE_URL is supplied privately; no value is printed here.
$env:LP_MODEL_LIVE_OPT_IN = 'false'
$env:LP_REMINDERS_CONSENT = 'false'
$env:LP_DEMO_TIMING = 'false'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:4310'
$env:PORT = '4310'
pnpm db:migrate
pnpm dev:cloud
```

These are future operator instructions, **not operations performed by this T14
implementation**. `db:migrate` explicitly applies `apps/cloud/src/db/schema.sql`
in a transaction; startup does not migrate automatically. `dev:cloud` runs
`apps/cloud/src/main.ts` with `tsx`. Alternatively, after the same migration and
configuration, `node apps/cloud/dist/main.js` runs the built cloud with installed
dependencies. Use one cloud instance for the owned database.

The default port is 4310. `PUBLIC_ORIGIN` defaults to the loopback origin above;
outside loopback, the code requires HTTPS. Ctrl+C requests cloud shutdown,
stopping manager/check-in dispatchers and closing the server/pool. An unconfigured
model is reported as `BLOCKED`; it does not silently use a fixture provider.

Railway is separately owned. PostgreSQL staging is **not an application
deployment**. Deployment PR12 is not joined or pinned to this candidate; this
document does not direct applying or deploying it. Hosted acceptance remains open.

## Pair and launch the desktop

In a private operator console using the same owned database, set the owner's
confirmed IANA timezone (for example `America/Chicago`), and issue a grant:

```powershell
$env:LP_OWNER_TIMEZONE = 'America/Chicago' # replace with the owner's confirmed zone
$env:LP_REMINDERS_CONSENT = 'false'
pnpm owner:grant
```

For an existing owner, privately configure `LP_OWNER_ID` to that owner's UUID
before issuing the grant. Omitting it creates a new owner. The command prints a
**secret, one-use pairing code** plus owner ID and expiry to that private console:
do not record, commit, redirect into evidence, or share that output publicly.
The code expires after ten minutes. Existing-owner reminder preferences are not
changed by this command (`ON CONFLICT DO NOTHING`); a false environment setting
does not revoke earlier reminder consent. V1 has no reminder-preference UI.

In a separate desktop terminal at the repository root, use the matching API
origin. The following source-preview configuration prevents accidental inherited
source/fixture/export opt-ins in that process:

```powershell
$env:LP_API_ORIGIN = 'http://127.0.0.1:4310'
$env:LP_MODEL_LIVE_OPT_IN = 'false'
$env:LP_DEMO_TIMING = 'false'
$env:LP_TEMPORARY_PAIRING = '0'
foreach ($setting in @('LP_RENDERER_URL', 'LP_SELECTED_SOURCE', 'LP_SYNTHETIC_SOURCE_NAME', 'LP_RECEIVING_MODEL_ENDPOINT', 'LP_EXPORT_DISCLOSURE', 'LP_FIXTURE_MODE', 'VITE_DEV_FIXTURES', 'NVIDIA_API_KEY')) {
  Remove-Item "Env:$setting" -ErrorAction SilentlyContinue
}
pnpm dev:desktop
```

`pnpm build` must have built the web renderer first. `dev:desktop` rebuilds only
desktop main/preloads, clears `ELECTRON_RUN_AS_NODE` for its child and launches
Electron with `apps/desktop`. By default main loads `apps/web/dist/index.html`;
no Vite server or browser is needed. Re-run the audit after any rebuild if you
need a receipt for those exact bytes. This launch uses the normal Windows app
profile; it does not create the isolated profile used by native acceptance tests.

Check the **Destination** in **Pair this desktop**, enter the private code and a
recognizable device name, then choose **Pair desktop**. The workspace opens only
after native capabilities confirm pairing at the same destination. On failure,
use **Retry connection**, verify the destination and request a fresh grant when
needed. Access credentials expire after 48 hours and are protected by Windows
safeStorage in main, never exposed to the renderer. Without protected storage,
default pairing is blocked. `LP_TEMPORARY_PAIRING=1` explicitly permits only a
memory session that needs re-pairing after exit; it is not the preview default.

Missing destination shows **Desktop connection unavailable**. Direct browser
launch shows **Desktop capability unavailable**, without establishing cloud or
model readiness. `pnpm dev:web` serves Vite at `127.0.0.1:5173` for renderer
development; only explicit `VITE_DEV_FIXTURES=true` enables its labeled synthetic
fixture workspace when no native bridge exists. It is not the source demo route.

## Privacy, source access and model defaults

- Keep `LP_MODEL_LIVE_OPT_IN` false. A later authorized live cloud phase needs
  explicit `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL`, private `NVIDIA_API_KEY`, and
  positive finite `LP_MODEL_CALL_BUDGET` / `LP_MODEL_TOKEN_BUDGET`. Opt-in starts a
  real startup probe and can dispatch queued work. No allowance is implied here.
- The separately qualified identity is `nvidia/nemotron-3.5-lightning-30b-a3b` at
  `https://integrate.api.nvidia.com/v1`; its standalone capability result does
  not enable the application or complete J2. See [model evidence](evidence/model-gate.md).
- No linked source means monitoring/export off. On a previously used profile,
  existing consent/bindings persist: clearing selection environment variables
  does **not** revoke them. Use the tray withdrawal actions before a preview if
  prior access exists. Do not inspect, copy or delete the profile to reset it.
- A future separately authorized source phase requires exactly one named own
  harmless synthetic conversation: `LP_SELECTED_SOURCE` is its exact thread UUID,
  `LP_SYNTHETIC_SOURCE_NAME` names it, and the current working directory must match
  its validated workspace. The adapter pins `codex-app-server` / Codex `0.166.0`;
  compatibility with other versions is unverified. No archive scan or implicit
  current-thread selection is supported. This setup does not operate Codex.
- Under **Sources & privacy**, **Select source** opens native confirmation and
  then an expiring preview. Local reading requires both local-read consent and
  the best-effort-filtering acknowledgment. **Cloud export** defaults to **Off**.
  Sharing additionally needs named `LP_API_ORIGIN`, `LP_RECEIVING_MODEL_ENDPOINT`,
  `LP_EXPORT_DISCLOSURE`, a selected policy and its separate consent. Leave these
  export settings unset in this preview. Metadata and approved excerpts are
  distinct policies; neither permits raw source/history upload. Filtering is
  best effort, not a guarantee, and provider-processed data cannot be recalled.
- A fresh owner has reminders off. Demo timing is off; enabling
  `LP_DEMO_TIMING=true` would shorten due time with a visible **Demo reminder
  timing** label, without bypassing consent, quiet hours, spacing or caps. Normal
  defaults are 21:00–09:00 in the owner's timezone, three unsolicited questions
  per rolling 24 hours, and 60-minute account spacing. Existing owner preferences
  require operator review rather than an environment-only claim of “off”.

## Stop monitoring, revoke and Quit

Closing the workspace hides it to the tray; **Hide pet**, **Focus (quiet pet)**
and click-through affect presentation. They do not withdraw source access.

1. Use tray **Pause all local sources…**, then confirm **Pause local sources**.
   It works without a reachable cloud or mounted source panel, provided protected
   local device custody is known. Reading stops; queued exports remain held.
   Cloud pause can remain pending. **Pause source** in Sources & privacy is the
   per-binding option when its current UI state permits it.
2. For withdrawal, choose tray **Revoke all local source access…** and confirm
   **Revoke local access**, or use **Revoke source** for a binding. Local reading
   stops and queued exports are purged; following again needs new consent.
   Reconnect with valid pairing for pending cloud revocation/excerpt removal.
   Local completion is not cloud acknowledgment and cannot recall provider data.
3. If local custody or journal saving is blocked, follow the sanitized native
   message; do not assume completion. Preserve `journal.json` and its `.previous`
   snapshot locally. Do not upload or clear them, reset a cursor or copy
   `device.protected`. Runtime data lives under the Windows application-data
   `LivingPlaybooks` directory and is outside the build audit.
4. Choose tray **Quit Living Playbooks** for actual exit. It stops observation
   and sync, clears in-memory credentials, flushes the journal, then destroys
   windows/exits. A flush failure shows **Quit blocked** and does not claim a
   durable exit. A normal Quit preserves saved consent/credentials for restart;
   pause/revoke first when access must remain withdrawn.
5. The operator can independently revoke the cloud device credential, using the
   correct private `DATABASE_URL` and `LP_OWNER_ID` environment and a verified
   device UUID: `pnpm owner:grant revoke-device <device-uuid>` (replace the
   placeholder). This invalidates server access; it is not a local source
   withdrawal or a deletion/recall of previously processed data. Re-pairing
   requires a fresh grant. Remove unneeded launch environment values from the
   terminal after shutdown; keep private configuration out of the repository.

## Deferred distribution

Portable packaging is optional/deferred. `pnpm package:win` currently exits
`BLOCKED: Portable packaging is deferred until the verified source build and
native smoke pass.` No installer, executable archive, signing, auto-update,
new packaging automation or hosted deployment is delivered here. Retain this
source procedure until the owner separately verifies a distribution route.
