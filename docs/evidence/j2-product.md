# J2 real-app acceptance entry

Status: **NOT RUN / BLOCKED pending lead review and explicit DB/native/provider phase release.**

The independently passed NVIDIA adapter probe is prerequisite evidence only. It is not a J2 pass. The native startup incident belongs to a separate lane; this implementation does not launch another GUI or claim that incident is resolved.

Parent resource update (reported by the lead, not queried by this lane): dedicated database `playbooks_j2_20261108_68866455` was migrated with the current production schema; owners/jobs/model_usage counts were zero at provision. The parent records `liveStarted: false` and plans at most 7 calls / 524288 reserved tokens. The parent will derive the owned URL from its private existing root connection template at runtime. This lane has not read that template, credentials or the ignored resource record. Startup PR24 head `daf927d3560f1f946c742efbad9ea52061bbb4e4` is published against PR15 with independent review pending; the original startup dialog is unresolved. No live release has been given.

Scope is the new `tests/integration/j2-product.ts` entry and its focused `j2-safety.ts` helper. J1 scripts, production code, dependencies, contracts, root commands and deployment configuration are unchanged. Base: prepared commit `6f49c94a928484732980aa2579dc9ffa7a2c79a5`; lead published the same tree as PR15 commit `6f8364742775b608d9a554880fc1274c7136efb4` (tree `0fcf3c17f9bc3f17021d7b0b8f0c973f906e1831`).

## Offline verification

Commands, run from the isolated checkout:

```powershell
pnpm exec tsx tests/integration/j2-product.ts --check-guards
pnpm typecheck
pnpm build
pnpm exec tsx tests/integration/j2-product.ts --check-build
git diff --check
```

Results: 48 guard checks PASS, typecheck PASS, production build PASS, built-cloud source-map checks PASS, whitespace check PASS. The guards include the parent-provided owned name and token allowance using an entirely synthetic connection template. An initial TypeScript inference error in the new polling query was corrected before the passing typecheck. An early inline CLI check failed on PowerShell quoting before executing checks; the file-based command above avoids that quoting issue. These are implementation checks, not an observed product failure/RED or provider evidence.

No full suite is run here: its DB helpers truncate `playbooks_test`. Guard checks use only synthetic configuration, pure assertions and fake query results, without opening PostgreSQL, Electron or a provider connection. They report `J2: NOT_RUN`, never a live acceptance pass.

The entry invoked with no flags returned `result: BLOCKED`, `stage: preflight`, exit 2 as expected, before opening any DB or native/provider resource. Review performed locally against the lead's brief; independent parent review remains pending. No children were started.

Built-cloud SHA-256: `637e668b83b739920843aec974d2c621e6e492689963b828c91673c734bd485a`.

Qualified adapter source SHA-256: `03b575109364e456a953229d2c73140cb6e8f16c963ceb7808533fa048490c19`.

Acceptance entry SHA-256: `43135d12eea694378d81697aad121ba217a9d477855fd76b108455e0ee0e1132`.

Focused safety helper SHA-256: `8f58a3a773104c9bfaf430c4abeab7669606c8ca17ee500ca310933c299e857b`.

Protected J1 entry/helper remain byte-identical to the prepared base, SHA-256 respectively `70d177d04599f198cc23a93f9412a4bf549acd167059332800075f3ef60b13e4` and `087ae98bfaf3be468f1b407c8e73d0dfb7c49aba79214530461caba5a23f99e1`.

## Parent preparation and future run

The lead must review this entry, resolve/review the separate native startup fix, and explicitly release the live phase. The parent provisions and migrates a **new separate empty** database on the already authorized local PostgreSQL endpoint. The harness performs no database creation, migration, drop, reset, truncation or ledger replenishment. It must not share `playbooks_test` with the root suite.

Required configuration is supplied by the lead at the actual run, without printing secrets:

- `LP_J2_DATABASE`: strict owned name `playbooks_j2_[a-z0-9_]+`, at most 63 characters.
- `DATABASE_URL`: supplied connection template with PostgreSQL protocol, host `127.0.0.1`, port `55432`, user `playbooks`, and no query or fragment. Only after validating the owned name does the harness replace the template pathname with that name. It never connects to the template's shared database or guesses a host.
- `LP_MODEL_LIVE_OPT_IN=true`, `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL`, `LP_MODEL_CALL_BUDGET=7`, and an explicitly authorized positive finite `LP_MODEL_TOKEN_BUDGET`. There is no token allowance preset or implicit opt-in. The provider/model choices remain the lead's responsibility.
- The lead supplies `NVIDIA_API_KEY` privately to the launch environment. The test never reads credential files, requests a key, prints a key, or passes it to the desktop. The production cloud child is the only spawned process receiving that key.

After release, the lead runs:

```powershell
pnpm build
pnpm exec tsx tests/integration/j2-product.ts --live --db-released
```

`--live`, `--db-released`, and the environment opt-in must all be present. These flags attest prior lead review, authorization and exclusive DB resource ownership; this document does not release that phase. Build the reviewed integrated source first. Runtime source-map guards compare the bundled adapter, runner, model settings and cloud entry with their exact current source contents, refusing a stale cloud bundle. Safe output includes bundle and adapter SHA-256 hashes.

Before issuing a grant or starting the model, read-only guards reject foreign queued/running jobs **including future-due jobs**, scheduler inputs, any preexisting application content, other sessions/dispatchers, and an incompatible or exhausted usage configuration. A session advisory lock prevents cooperating J2 scripts from overlapping. The lead's exclusive-resource release is still required; this lock does not replace operational ownership.

## Journey and assertions

The harness starts **one** built production cloud, whose `configureModel` awaits its capability probe before listening. Startup has a 135-second bound for the production 120-second probe. It never runs a standalone probe, retries a cloud start or starts a second dispatcher. The ledger must show 2–3 startup calls and an available production capability gate.

It issues a direct grant for one unique synthetic owner with reminders false, and launches the built desktop with isolated appData/userData/sessionData, trusted UI pairing and actual Windows protected storage. Desktop environment is restricted to J1's system allowlist plus `LP_API_ORIGIN`; source, reminder, demo, fixture and temporary pairing flags are absent.

Through the owner UI it creates one synthetic brief requesting `read_project_state`, one Todo task **Prepare synthetic demonstration**, and one checklist referencing that task. It captures the initial canonical project/manager/workspace identity and empty revision before the proposal. The actual production `initial_plan` worker must finish within 150 seconds. A failed, superseded or retry-queued job ends the run immediately; it never waits through a retry delay or manually invokes the worker.

Acceptance requires the same single job and manager reply, 2–4 job model calls, at least one actual `read_project_state` tool receipt with a SHA-256 result digest, and matching tool counts. The runner itself does not mandate that tool; the harness explicitly checks its persisted receipt. The saved task must have revision 0, ownerOverride false, brief origin and no evidence. The saved valid checklist must reference that exact task; workspace revision must advance while workspace and manager identities remain unchanged. The generated checklist, task and exact saved manager reply must render through the trusted UI, applying an arrangement only if that UI offers it.

The owner selects `in_progress` using `Status: Prepare synthetic demonstration`. The canonical task revision must increment once, ownerOverride must become true, and the owner decision and visible **Owner correction** label must persist after renderer reload. Project, manager, workspace, checklist, task, job, reply and decision IDs must remain unchanged; reload must not spend or queue more work. Sources, check-ins, documents, observation uploads, reminders and extra jobs remain absent. No chat submission or full native restart is part of this minimum journey.

## Allowance and cleanup receipts

Maximum combined allowance is seven calls: at most three startup calls plus at most four worker calls. The token ceiling is the lead's explicit setting and the production adapter reserves against it. Actual `model_usage` calls and reserved tokens are inspected before startup, after startup, after the job and after process shutdown. Effective limits use `min(stored limit, configured limit)`, with remaining allowance reported. Configuration identity is exactly SHA-256 of `JSON.stringify({baseUrl,model})` using the **exact supplied base string**, without URL normalization. A previously charged seven-call configuration cannot restart this journey; there must be seven calls remaining before startup. Do not repeat after failure or replenish the ledger.

Cleanup stops the exact owned cloud process tree before the desktop, removes only the unique synthetic owner's fixed project/content IDs, and removes only a checked direct-child temporary profile with the `lp-j2-product-` prefix. If process termination cannot be confirmed, content/profile cleanup is withheld. The actual charged `model_usage` row is never deleted or updated by cleanup, and before/after equality is asserted. Output contains only fixed stage/result labels, safe IDs/hashes/counts/booleans and allowance receipts. Raw provider errors, source/model contents, pairing data, traces and screenshots are not emitted.

Live result: **NOT RUN**. Actual ledger, remaining allowance, native acceptance and full J2 acceptance remain unmeasured until the lead's released run.
