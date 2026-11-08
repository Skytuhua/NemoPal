# Integration checkpoint: 2026-11-08 UTC

This is a partial product checkpoint, not final release acceptance.

Production source: `f1718a9f1698a32181b594f83b82360f59645f16`, tree
`7b35ae8b0e78fda816492c126f91ed843d0b00b9`, on
`feat/golden-workflow-integration` (PR15). It includes reviewed cloud, desktop,
pairing, tray/enrollment corrections, startup fencing and the J1/J2 harnesses.
Main has not received this joined desktop/product candidate. Railway deployment
and the separate pet artwork leaf are outside this checkpoint.

## Executed verification

The parent executed the following on the joined source, not just a child report:

```powershell
pnpm build
pnpm typecheck
pnpm exec tsx tests/integration/j2-product.ts --check-guards
pnpm exec tsx tests/integration/j2-product.ts --check-build
node --env-file=.env ./node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
pnpm evidence:check
git diff --check
```

Results: cloud/web/desktop production build and TypeScript PASS; 48 pure J2
guards and current compiled-source checks PASS; **67 files / 361 tests PASS**
in 136.99 seconds. The serial suite used only the authorized disposable
`playbooks_test` database; it did not connect to the separate J2 database.
The evidence checker validates declarations/references; it does not execute
acceptance. At this source commit it still reported zero marked passes.

Built cloud SHA-256:
`a1519bf797cb5c3c9797f8108095e2b2d0bed90e14754ec32de22cf7d8d201aa`.
Qualified adapter source SHA-256:
`03b575109364e456a953229d2c73140cb6e8f16c963ceb7808533fa048490c19`.

## Actual Windows confirmation

After PR24's independent review and 60 focused tests, the parent ran both:

```powershell
node --env-file=.env --import tsx tests/integration/j1-product.ts --db-released
node --env-file=.env --import tsx tests/integration/j1-product.ts --db-released --checkin
```

Both returned PASS. The tested provisional merge tree was
`59e8ac990d5b6f5071becc73df625c48ff5fd808`; after PR22 merged, parent verified
that exact tree at `dca5b9be379dcf8a070648012997eeafd5854b81`.
The J1 entry SHA-256 was
`1a0241deb92e8d0558d35b9713499ecee0ca23addc52bd573198f72aeb15009e`.
PR25 subsequently added only its three reviewed harness/evidence files.

Confirmed in both runs: actual built main in isolated AppData/sessionData,
Windows safeStorage, trusted UI pairing, project title/brief and owner Phase
save, renderer reload and full native restart without re-pairing. The scripted
run also confirmed production scheduler admission, actual native pet Recorded,
the same saved question/task, and answered restart/reconnect without a repeated
logical question. Exact owned processes, unique synthetic owner and isolated
profile cleanup all passed. Model/source/export/demo stayed OFF; only the
scripted unique owner had reminder consent. The default journey kept reminders
OFF.

No startup-fatal dialog was observed in these ordinary journeys. They do not
recover the historical dialog's finer cause, induce an actual early renderer
abort/failed-flush race, prove physical tray/input behavior, or establish live J4.
See `startup-shutdown-incident.md` and `native-checkin.md` for earlier evidence.

## Journey status

| Journey | Result | Limit |
| --- | --- | --- |
| J1: trusted owner edit and persistence | Actual local Windows PASS | No inference/source |
| T03 / A04: native model tool/result/proposal | LIVE capability PASS | Standalone adapter, not full J2 |
| J2: generated app plan, owner correction, reload | BLOCKED / NOT RUN | Launch rejected before execution |
| J3: actual selected source through manager/evidence | NOT RUN | Two fresh persisted deltas and joined model path missing |
| J4: persisted question through pet | SCRIPTED native partial PASS | Fixture admission, not model/source-driven J4 |
| J5: full recovery/revoke scenario | NOT RUN | J1 restart and synthetic race tests cover only subsets |

The successful standalone capability probe used
`nvidia/nemotron-3.5-lightning-30b-a3b` at
`https://integrate.api.nvidia.com/v1`, with three HTTP 200 requests. It is
recorded at immutable evidence commit
`e0b07b89a0c2be4fdb685f6804cf5b465aa2374a`. Earlier denied submissions remain
in `model-gate.md`; no prior usage is erased by a later allowance.

The parent attempted one J2 launch bounded to seven combined startup/worker
requests and 524288 reserved tokens. Automatic approval rejected the process
creation with only **blocked by policy**, before executing the command. No key
read, provider request, native launch or database connection occurred. The
separate migrated J2 resource remains `liveStarted: false`; its usage ledger has
not been replenished or deleted. Do not retry the rejected action through
another execution path. Its private credential is not part of this repository.

## Remaining release gates

Live J2 execution, actual selected-source observation, complete J3/J4/J5,
physical tray/overlay acceptance, hosted pinned deployment, final golden demo,
recording and artifact audit remain open. MCP and phone are optional/deferred;
portable packaging is deferred in favor of the reviewed source launch. The
acceptance matrix records only individually substantiated passes, rather than
promoting the passing test suite to full product acceptance.
