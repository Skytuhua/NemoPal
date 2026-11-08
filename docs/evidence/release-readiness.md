# T14 release-readiness preparation

**Preparation only.** At source I, the acceptance ledger records exactly **3 standalone live passes (A04/A09/A10), 30 `not_run`, 2 `deferred` (A32/A33), and 1 `blocked` (A36)**. Full J2 is **NOT RUN / policy-blocked before launch**; full J3/J4/J5 and final T11/T14 acceptance remain open. This packet adds no acceptance result.

## Source and receipt custody

| Identity | Exact pin / meaning |
| --- | --- |
| I: reviewed integration used for this packet | Commit `617cc7a667a051b2f424b7b87a0c977ea9d6a6bf`, tree `7bbbbb8259ece8266f0be82d5a48dd99f2f87684`; `feat/golden-workflow-integration` ([PR15](https://github.com/Skytuhua/NemoPlaybook/pull/15)). PR34/35/36 privacy fixes are merged into integration only. |
| Prepared documentation checkout | Clean starting HEAD/tree exactly I; branch `t3/release-readiness-packet`, checkout `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-9ab24e43`. Exclusive ownership: new `docs/evidence/release-readiness.md` only. |
| Research inputs, historical | Report R inspected integration `10c774c43f099d2d8859922f54b8faabefbb12f1` and frozen PR36 `e8e0ab82c2d3ab8a85f8611813b845d8622d8060`; I now includes that reviewed join. Those report-era pins are not a final build. |
| Approved plan P | `living-playbooks-master-plan.md`, byte-identical to the supplied attachment; SHA-256 `b754fdeed280311545f354496e3fa3be407b7254a6a3dbd758f06778dd94e5f0`. Relevant lines: 817-847 (dependencies/J1-J5), 994-1019 (T10/T11), 1042-1051 (T14), 1083-1124 (A01-A36), 1155-1190 (demo/evidence/handoff). |
| Historical receipts | H1/H4/HJ/M/O/B below identify older tested sources and bytes. Their PASS labels do not transfer to I or a later UI/build. |
| Future final joined source/build | **Unassigned here.** Lead must record the accepted native + UI + integration commit/tree, toolchain/lockfile identity, actual compiled file inventory/digests and a new quiescent manifest. This documentation commit is not that runtime identity. |

All repository references below are **I:path**, unless a different immutable commit is written. [Pinned source tree][source], [ledger][ledger], and [plan][plan] are the reference roots. P line numbers also apply to the supplied attachment. R is `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-1d147f86/.tmp/research/master-plan-readiness-20261107.md`, especially lines 114-160, 178-208 and 210-227; its earlier runtime/review dependencies are historical where this assignment explicitly updates them.

| Receipt | Immutable identity and supported scope |
| --- | --- |
| H1: actual Windows J1 | [J1 receipt][j1]: source parent `cb888ef78f9a0aaed9ddd8f016731cb4880ae063`; original tested harness SHA-256 `2944c7cf617d83d9c80a22375b0db75ebe82a098f946fbd7c89edbccec882864`; corrected parent rerun at receipt commit `d6764b71d6093410161481a5bf8adfad9a9b2bc5` records harness `70d177d04599f198cc23a93f9412a4bf549acd167059332800075f3ef60b13e4` and safety helper `087ae98bfaf3be468f1b407c8e73d0dfb7c49aba79214530461caba5a23f99e1`. Actual pairing/safeStorage/create/owner Phase save/reload/desktop restart; model/source/export/reminders OFF. |
| H4: SCRIPTED native question | [Native check-in receipt][scripted]: source/base `fe8e940a8837edcd364b722a13a8aec696789ee4`, receipt commit `7d1088340b910c9fb9c3d24467c2799a4060ec49`; final scripted harness SHA-256 `1a0241deb92e8d0558d35b9713499ecee0ca23addc52bd573198f72aeb15009e`. Its separate default J1 run used `fb34cfbcc3a34028d39efea89b120b2fe63c1f0cc1e4d11d473edd444ceda079`. Actual scheduler/pet/Recorded/persistence with a directly installed, visibly SCRIPTED canonical question; no model/source generation. Full J4, snooze, cloud restart and physical input acceptance are excluded. |
| HJ: later joined native confirmation | [Integration receipt][joined], lines 38-67: parent reran default J1 and SCRIPTED check-in on provisional tree `59e8ac990d5b6f5071becc73df625c48ff5fd808`, then verified that exact tree at `dca5b9be379dcf8a070648012997eeafd5854b81`. Harness SHA-256 `1a0241deb92e8d0558d35b9713499ecee0ca23addc52bd573198f72aeb15009e`. This later rerun does not rewrite H1/H4's earlier identities or establish I/native/UI acceptance. |
| M: A04 standalone capability | Ledger receipt commit `e0b07b89a0c2be4fdb685f6804cf5b465aa2374a`, [model gate][model], lines 67-75; tested source `be586bcfe96ae78529cd0dd61ff2c123f48fa164`. Actual Nemotron tool/result/strict proposal capability; three successful HTTP submissions, `fullAppVerified: false`. No full-app generation/edit/reload or source join. |
| O: A09/A10 installed observation | Ledger receipt commit `870e98eeea70ef33090a5de08a2f4417d270fa30`, [live observer][observer]; reviewed gate `ba23c1ddaaf739d464a3bb2188877f8de5d920c6`, gate SHA-256 `6a414a21f96c2a6f9402f7f3e868ba2549e7af280228a8a2b532864547523e5f`, byte-identical gate/contracts/observer in `8b5fed24c0f5cd27458aad41a2b07613d62fa589`. Installed Codex 0.166.0; exact harmless source, zero backfill, export OFF, two distinct persisted items, 652/935 ms detection latency, reader and child exit confirmed. Items were `user_visible_message/user_reported` and `assistant_report/agent_reported`; neither is A14 tool-exit evidence. |
| B: bounded output audit | [Build-output receipt][build], lines 3-8, 59-95, 143-175: original source base `f1718a9f1698a32181b594f83b82360f59645f16`, original PR27 `03cf2c5dcffdbce44cd97d420b0c23e19a6fc586`; subsequent auditor corrections and PNG exception are separately described. That old output manifest is not evidence of I or the future final build. |

## Current interpretation and run prerequisites

Early `preflight.md:10-18` describes foundation-era blocked model/observer gates and absent native implementation. `integration.md:76,97` still calls actual source observation missing; `observer-gate.md:58-63` gives an earlier pending gate. Later M/O and the current ledger supersede that **standalone capability** wording. A36's reason likewise retains an older missing-source clause. Actual standalone A09/A10 passed; **selected delta -> journal -> ingest -> manager interpretation -> evidence card J3 did not**. No historical file or ledger entry is rewritten here.

[UI PR33](https://github.com/Skytuhua/NemoPlaybook/pull/33), exact replacement `4e8056f82b134766431195eb0d3657a1978dbe3c`, is reported reviewed but remains **DRAFT/HOLD for user visual feedback, unaccepted**. This packet does not inspect that changing checkout. Tests/screenshots do not supply user visual or actual native acceptance. PR34/35/36's merged synthetic privacy coverage does not close those gates.

Prerequisite codes below describe **future coordinator gates**, not authorization to run from this leaf:

| Code | Required before the remaining assertion can be accepted |
| --- | --- |
| F | Lead pins reviewed final integration/native and user-accepted UI, resolves the external process-launch policy blocker through the authorized workflow, and assigns exclusive runtime resources/finite bounds. Model use, where needed, needs its own explicit finite allowance; no provider substitution. Owning lanes supply product assertions/selectors. |
| S | F plus exact harmless current source selection, explicit local-read permission, independent export/receiving-endpoint/model-disclosure consent, compatible pinned adapter, current-tail zero-backfill enrollment and newly persisted ordinary work. O's export OFF is not cloud-share consent. |
| N | F plus actual Windows main/pet/tray/input checks and exclusively owned scheduler/question/profile resources; reminders require explicit consent. Fixture rendering is insufficient. |
| R | F, joined J3/J4, T11 independent boundary review, deterministic races first, then the affected authorized real recovery/revoke regressions. |
| D | R plus the final pinned, finished quiescent build/audit, required checks, two full demos and a disconnect/pause run, recording and honest evidence handoff. |
| X | Optional work remains deferred; Lead must explicitly reprioritize it after T11. It never blocks T14. Packaging is also deferred. |

Owners follow P: **A** owns T02/T03/T08 cloud/model/check-ins; **B** owns T04/T05/T07 native/observer/delivery and T12; **C** owns T06 UI; T09 is B transport + C rendering; T13 is C presentation + A authorization. **Lead** owns T00/T01/T10/T11/T14 and independent review/integration. Other workers retain their files, including the separately owned new `tests/desktop/j3-delivery-prepared.test.ts`; its synthetic preparation cannot accept J3/J5 or any A case.

## J1-J5 mapping

| Journey | Recorded status / available receipt | Remaining assertion on final join | Owner tasks; prerequisite |
| --- | --- | --- | --- |
| J1 | Historical actual Windows PASS: H1, HJ | Reconfirm the final built main/UI, trusted auth/create/read/edit/reload/restart against the same saved project; no historical transfer. | Lead + A/B/C, T02/T04/T06/T10; F/N |
| J2 | **NOT RUN / policy-blocked before launch**; M is standalone only | Actual Nemotron -> actual scoped tools -> validated saved canvas -> owner correction -> reload. | A/C + Lead, T03/T06/T10; F |
| J3 | **NOT RUN / unaccepted**; O only observes, export OFF | New selected items -> durable controller/journal -> real ingest receipt/reflection -> actual model evidence read/result -> saved reply/task/card with matching observation IDs and honest labels. | B/A/C + Lead, T05/T07/T03/T06/T10; S |
| J4 | **Unaccepted**; H4/HJ are SCRIPTED native partial PASS | Model/source-derived durable due question -> actual pet -> answer and snooze -> same canonical workspace/question; include reload and cloud/native restart. | A/B/C + Lead, T08/T09/T10; S/N |
| J5 | **NOT RUN / unaccepted**; HJ restart and isolated tests cover subsets | Final joined restart/reconnect/revoke, stale-result fences and no duplicate logical question, with stable project/task/question/presentation identities. | Lead + A/B/C, T10/T11/T14; R |

J2's rejected process creation returned only `blocked by policy`; the [historical integration receipt][joined], lines 87-93, records no command execution, key read, provider request, native launch or DB connection. It is neither a product failure nor a pass. The held root `C:/Users/user/Documents/NemoPlaybook` remains entirely outside this leaf at `8ff0245250dd044e5ab8ca15daead76142fb78b5`, including build/env/keys/one-shot marker/model usage. No query, reset, replenishment, launch recipe or alternate execution route is part of this packet. Existing private credentials require no new request.

## A01-A36 mapping

Statuses are copied from [I:acceptance.json][ledger], not inferred from receipt/file/test presence. **None** means no individually accepted receipt is recorded; related historical/partial proof is explicitly qualified. For passed cases, the remaining assertion concerns the final joined scenario, not revocation of the narrow historical pass. Owner tasks resolve to the lanes above; codes identify prerequisites.

| Case / scenario | Recorded status | Available receipt | Remaining assertion | Owner tasks; prerequisite |
| --- | --- | --- | --- | --- |
| A01 New prompt, no prior history | `not_run` | None | Provisional tasks/unknown progress, no invented past work. | T03/T06; F |
| A02 Plain-text brief | `not_run` | None | Requirements cite the brief; suggestions remain labeled. | T03/T06; F |
| A03 Unsupported file | `not_run` | None | Visible `.txt`/`.md` limit; no invented PDF contents. | T06; F |
| A04 Genuine Nemotron loop | `passed` / `live` | M | Carry real scoped tool/result/proposal into saved app generation/edit/reload for J2. | T03/T10; F |
| A05 Wrong model/key/endpoint | `not_run` | M contains earlier denied attempts, not this acceptance | Visible failure without provider/model substitution. | T00/T03; F |
| A06 Invalid/malicious workspace | `not_run` | None | Preserve last valid view and reject script/action authority. | T01/T06/T11; F |
| A07 Owner edits during response | `not_run` | H1/HJ save only; no delayed model join | Late proposal cannot replace correction or draft. | T03/T06/T11; F/R |
| A08 Unselected thread | `not_run` | O selects one source only | No read/export of an unselected thread in the joined path. | T05/T07; S |
| A09 Read-only Codex observation | `passed` / `live` | O | Preserve no start/resume/inject/approval/interrupt in product J3. | T00/T05; S |
| A10 Two fresh persisted source items | `passed` / `live` | O | Correlate fresh item provenance/timing through journal, ingest, manager and card. | T05/T10; S |
| A11 Unsupported/changed source | `not_run` | None | Visible paused/stale/blocked state; no invented progress. | T05; S |
| A12 Partial/rotated record | `not_run` | None | Reject unsafe acceptance/cursor advance and retain recovery custody. | T05/T07; S |
| A13 Agent says done | `not_run` | O has an `agent_reported` item only | Task/reply/card retain claim strength; no independent-verification label. | T03/T10; S |
| A14 Source tool exit observed | `not_run` | None; O contains no tool exit | Only the matching observed check is supported; provenance retained. | T03/T05; S |
| A15 No excerpt consent | `not_run` | O export OFF; no upload join | No transcript text leaves the device without consent. | T07/T11; S/R |
| A16 Secret/reasoning fixtures | `not_run` | None | Synthetic sentinels/reasoning excluded from upload, UI and diagnostics. | T05/T07/T11; S/R |
| A17 Revoke offline/in flight | `not_run` | None | Immediate local stop, durable cloud-pending withdrawal, old exports/results denied. | T03/T07/T11; S/R |
| A18 Lost upload response | `not_run` | None | Same operation/body replays the receipt; no extra logical observation/reflection/question. | T02/T07; S/R |
| A19 Source queue full/corrupt | `not_run` | None | Visible pause; no silent drop or unsafe cursor advance. | T07; S/R |
| A20 Cross-owner/project request | `not_run` | None | 403/404, no snippet/count leakage or mutation. | T02/T11; F/R |
| A21 Duplicate owner command | `not_run` | None | Identical replay returns same result; changed payload conflicts. | T02; F |
| A22 Cancel/lease expires during model run | `not_run` | None | Late result cannot commit or gain replacement authority. | T03/T11; F/R |
| A23 Restart with due reminder | `not_run` | H4/HJ partial; no cloud restart | Durable model/source question survives cloud/native restart without repetition. | T08/T11; S/N/R |
| A24 Complete task before due time | `not_run` | None | Suppress obsolete question after completion. | T08; N |
| A25 Snooze/quiet hours/caps | `not_run` | H4 eligible-hours Recorded only | Persist/enforce snooze, quiet hours and caps without model discretion. | T08/T09; N/R |
| A26 Same question in chat/canvas/pet | `not_run` | H4/HJ partial same-question/task answer | One canonical ID/answer across all final surfaces. | T09/T10; S/N |
| A27 Main window closes | `not_run` | H1/HJ restart only | Actual close-to-tray/pet continuation and Quit stops observation. | T04/T09; N |
| A28 Overlay and input | `not_run` | H4 presentation only | Physical Windows focus, Hide/Open/click-through escape, display behavior. | T04/T09; N |
| A29 Cloud or source stale | `not_run` | None | Separate honest source/cloud status and last-observation time. | T07/T09; S/N/R |
| A30 Model/UI idle | `not_run` | H4 unchanged usage only in SCRIPTED path | No repeated inference for heartbeat/pet animation in full scenario. | T03/T09; S/N |
| A31 Project switch with late data | `not_run` | None | Late A data cannot replace B UI, draft or authority. | T06; F/R |
| A32 Optional MCP | `deferred` | None | If resumed: two scoped tools only; reports remain claims, no transcript assumption. | T12; X |
| A33 Optional phone | `deferred` | None | If resumed: real saved state on phone; mutations denied server-side. | T13; X |
| A34 Build/package output | `not_run` | B source-build audit only | Fresh final output inventory/digests, bounded scan and sharing review; packaging deferred. | T14; D |
| A35 Backup/restart after accepted update | `not_run` | H1/H4/HJ partial desktop persistence | Same joined project/answer after backup/restart/replay; no reexecution. | T11/T14; R/D |
| A36 Full demonstration | `blocked` | None; J2 launch rejection | Actual model + selected source + native pet + persistent answer on final accepted build. | T10/T14; S/N/D |

Existing isolated coverage is preparation: `tests/desktop/spool.test.ts`, `sync-http.test.ts`, `revoke.test.ts`, `journal-failure.test.ts`; `tests/cloud/transactions.test.ts`, `revocation.test.ts`, `model-safety.test.ts`, `process-restart.test.ts`; and the PR34/35/36 synthetic authority regressions. R:64-100 describes their boundaries. No such test was run by this packet, and a simulated HTTP receipt/counter cannot establish persisted cloud observation/job/question counts.

The real join must preserve cursor+queue atomically through reopening; correlate item/revision, observation, binding/grant and operation identities; then prove actual ingest -> coalesced reflection -> scoped `list_recent_evidence`/`read_evidence` -> committed proposal -> saved card. Relevant I sources: `apps/cloud/src/domain/store.ts:176-218`, `apps/cloud/src/jobs/worker.ts:5-41`, `packages/nemotron/src/tools.ts:8-19`, `packages/contracts/src/domain.ts:49-56,63-82`, `packages/nemotron/src/proposal-validation.ts:13-47`. Count reflection jobs separately from initial planning; two deltas need not mean two jobs. Replay cannot create another logical update/question. Generated output cannot invent owner completion or upgrade an agent claim into verification.

## Existing auditor and future final evidence checklist

[I:scripts/audit-build-output.ts][auditor] already audits only `apps/cloud/dist`, `apps/web/dist`, `apps/desktop/dist`; its CLI takes no path override. It requires seven fixed entries plus flat generated JS/CSS/SVG assets and valid local HTML references. Inventory/type/containment/link checks precede content reads; symlinks/junctions, hard links and unexpected formats fail closed. Limits are **512 files / 1,024 aggregate directory entries / 16 MiB per file / 64 MiB total**. Text scanning covers known credential patterns, maps and two bounded JSON/unicode decoding passes with sanitized diagnostics.

The sole binary exception is `assets/pixel-mouse-idle-v1-<generated>.png`, exactly **960766 bytes**, SHA-256 `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`; it is not general PNG admission. No auditor/allowlist/scanner change is needed here. A pattern scan reports `secretAbsenceProven: false`; arbitrary encodings/private text can evade it. Maps contain source and require sharing review. Path checks are not a sandbox against a hostile concurrent writer. The manifest is neither a signature/reproducible-build proof, dependency/package review nor runtime/native/visual acceptance. See B:97-136,143-175.

The [evidence checker][checker] validates ledger inventory/status/mode, commit existence and referenced paths; it does not execute acceptance or establish that receipt prose is true. Neither checker is run by this leaf.

Future **Lead-owned, gated** checklist (P:T10/T11/T14 and R:178-208); all items remain unchecked:

- [ ] Pin final reviewed integration/native and user-accepted UI commit/tree. Close the external policy gate without an alternate launch route. Assign exclusive disposable resources, finite operation/cleanup bounds and separate model/source consent; preserve the held J2 resources and accounting.
- [ ] Under that later authorization, use the frozen lockfile/toolchain, appropriate intended-resource migrations and required type/unit/e2e/build checks; record exact outcomes and independent review. Do not import a suite helper that truncates shared state/model usage.
- [ ] Finish the own build, stop writers, then retain a **new** auditor receipt: sorted relative `path, bytes, sha256` inventory and SHA-256 of UTF-8 `JSON.stringify(files) + '\n'`, with source/tree/toolchain/auditor pins. Never copy B's historical manifest/digests as the final identity. Do not widen asset admission to accommodate unaccepted UI.
- [ ] Verify actual readiness, correct source mode/model/tool receipts, journal/ingest/card identity, owner corrections/drafts and project persistence. Complete J3/J4 and T11 recovery: lost response, offline/in-flight revoke, late results after edit/cancel/lease change, receiver change, full/corrupt journal, project switch/re-pair and due/snoozed/answered replay. Require no stale commit, resurrected excerpt/dependency, old-owner send or duplicate logical question.
- [ ] Exercise actual Windows close-to-tray/pet, focus/click-through/Hide/Open and Quit; distinguish stop-observation, pause-reminders, cancel-job and Quit. Confirm proper owned process shutdown. Historical native results, module fixtures and screenshots do not close physical or user visual gates.
- [ ] Run the actual golden scenario **twice from known state**, then a safe disconnect or source-pause run. Preserve the same project/task/question/answer through refresh, cloud/native restart and reconnect; no extra logical inference/check-in from replay. Record actual behavior and label backup/replayed footage honestly.
- [ ] Publish only safe immutable receipts (versions, times, counts, statuses, digests), recording reference, reused-code/licenses and known limits. Keep raw transcripts, source IDs/paths/cursors, credentials, provider bodies and private configuration out. Record actual case modes/outcomes; leave missing cases `not_run`, `blocked` or `deferred`. MCP/phone/packaging stay deferred; this leaf authorizes no main/release/deployment/Railway action.
- [ ] Stop owned observation/sync/cloud/native instances before cleanup; verify their exact process termination. Remove only exact synthetic owner/project records and checked test-created paths after resolved containment/link checks. No broad kill, DB truncate/reset/drop, default-profile or held-root cleanup. If stop/flush/cleanup fails, retain evidence/state for its owner and mark the run incomplete/failed/blocked; do not silently retry live.

This file's verification is static source/plan/ledger cross-check, one-path ownership inventory and `git diff --check` only. No tests/typecheck/build, runtime/private-state queries, source observation/export, model calls, native/browser/VM or deployment work is required or claimed. Parent owns independent review, checks, integration and acknowledgment before completed/result-available/no-pending-child confirmation and recoverable archive; this child has no children and does not self-archive.

[source]: https://github.com/Skytuhua/NemoPlaybook/tree/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf
[ledger]: https://github.com/Skytuhua/NemoPlaybook/blob/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf/docs/evidence/acceptance.json
[plan]: https://github.com/Skytuhua/NemoPlaybook/blob/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf/living-playbooks-master-plan.md
[j1]: https://github.com/Skytuhua/NemoPlaybook/blob/d6764b71d6093410161481a5bf8adfad9a9b2bc5/docs/evidence/j1-product.md
[scripted]: https://github.com/Skytuhua/NemoPlaybook/blob/7d1088340b910c9fb9c3d24467c2799a4060ec49/docs/evidence/native-checkin.md
[joined]: https://github.com/Skytuhua/NemoPlaybook/blob/8ff0245250dd044e5ab8ca15daead76142fb78b5/docs/evidence/integration.md
[model]: https://github.com/Skytuhua/NemoPlaybook/blob/e0b07b89a0c2be4fdb685f6804cf5b465aa2374a/docs/evidence/model-gate.md
[observer]: https://github.com/Skytuhua/NemoPlaybook/blob/870e98eeea70ef33090a5de08a2f4417d270fa30/docs/evidence/live-observer.md
[build]: https://github.com/Skytuhua/NemoPlaybook/blob/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf/docs/evidence/build-output.md
[auditor]: https://github.com/Skytuhua/NemoPlaybook/blob/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf/scripts/audit-build-output.ts
[checker]: https://github.com/Skytuhua/NemoPlaybook/blob/617cc7a667a051b2f424b7b87a0c977ea9d6a6bf/scripts/check-evidence.ts
