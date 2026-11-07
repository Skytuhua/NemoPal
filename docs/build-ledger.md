# Build ledger — living-playbooks-master-plan.md

Authoritative scope: unchanged owner-supplied master plan. Original baseline `c388cc8`. Feature branch `feat/foundation-contracts`; public PR required before foundation lands. No merge/deploy is authorized by the plan alone.

## Preflight interface scan

| Producer / consumer | Shared surface | Finding / ruling |
|---|---|---|
| T00 -> T01/all | Toolchain, root scripts | Pins and setup belong to Lead; model and source live gates can stay blocked while fixture work proceeds |
| T01 -> T02/T03/T08 | Domain/API/model DTOs | Strict shared source; accepted job cannot fabricate completion; check-in has independent revision |
| T01 -> T04/T05/T07 | IPC, LocalStore, observer/source DTOs | Local cursor/path never enters ingestion/renderer preview; main retains credentials |
| T01 -> T06/T09 | Client, snapshot, six panels, PetBridge | Source commands added to full client; flat panels avoid new layout types |
| T02 -> T07 | Enrollment/ingestion/receipts | Same typed endpoints, stable upload operation, current device/grant authority |
| T03 -> T06/T08 | Proposal/workspace/question | Cloud authorizes/apply-fences results; UI only renders persisted records |
| T04 -> T09 | Separate pet preload/window | B owns native, C owns renderer/art; typed pet events only |
| T05 -> T07 | Batch/cursor | Atomic local queue before cursor advance; no history read before consent |
| T08 -> T09 | CheckIn identity/presentation | New presentation identity only for a new eligible attempt; repeats do not reinterrupt |
| T03/T07/T09 -> T10 | Golden integration | Live model/source/native evidence distinct from fixture proof |
| T10 -> T11/T14 | Acceptance/recovery/build artifacts | Independent review plus actual checks; never infer cloud/native proof from unit tests |
| T11 -> T12/T13 | Optional extensions | Deferred until core gates pass; cannot block release evidence |

T00–T14 self-consistency: all tasks preserve global scope/consent and share the ownership above. T00's empty-process smoke moves to A/B handoff because product composition belongs to those lanes; not yet verified. T01 normalizes expected answer revision to its command envelope once. API error fields and `SnoozeInput.until` retain exact plan names. Model-created tasks derive server/owner fields. No broader design change is authorized.

## Task state

| Task | State | Evidence / blockers |
|---|---|---|
| T00 | established; live gates blocked | Public repo created; toolchain pinned; dedicated local PostgreSQL ready. Empty-process smoke joins lane A/B delivery. Nemotron/cloud/source live gates pending |
| T01 | complete for dispatch | Shared strict schemas/client and golden fixtures verified; independent review findings fixed with regressions. Frozen commit supplied in lane dispatch |
| T02/T03/T08 | not started | A receives frozen commit and isolated checkout |
| T04/T05/T07 | not started | B receives frozen commit and isolated checkout; no private archive scan |
| T06/T09 | not started | C receives frozen commit and isolated checkout; requested design skills apply |
| T10/T11/T14 | not started | Require lane delivery, joined tests, review, truthful acceptance ledger |
| T12/T13 | deferred | Core gates first |

## Independent review

- Read-only contract preflight identified check-in revisions, incomplete source client surface, local/cloud DTO separation, and fixed panel references. Accepted into foundation.
- Independent code reviewer found seven Important contract issues. Fixed all: observation kind/metadata/provenance/excerpt agreement, server-derived model task authority fields, required revision signatures, complete safe errors, exact `until` snooze input, accepted-only job receipts, and a valid-baseline privacy regression. Negative regressions were observed red then green. No live/source/native assertion follows from that review.
- Independent transport/security reviewer found missing receipt-hash and record-scope validation. The client now binds receipts to exact path/normalized command plus known result identities, covered by negative regressions. Redirects are denied, response/SSE frames bounded, authorization confined to injected main transport, and fixture fallback is never automatic.
- Independent build reviewer found weak acceptance validation. Regressions first demonstrated unsupported live-vs-fixture mode, missing evidence/revision, and unknown/incomplete case inventories accepted; all now fail. Acceptance references must exist in the declared commit. The checker validates references and inventory, never executes the claimed acceptance.
- Native helper results are acknowledged and retained. The native API supplies no T3 task ID/child thread handle to archive. Prepared T3 implementation children will use the requested completed-task confirmation and recoverable archive flow.

## Live gates

Nemotron API application pending; model/base URL/key/budget missing. Cloud host not selected. Owner permits choosing a harmless build-test source; exact strategy, supported version, two fresh persisted deltas, and noninterference still need proof. Export remains off until endpoint/disclosure is explicit. Docker database is local test infrastructure only, not a hosted deployment.
