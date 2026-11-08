# Build ledger — living-playbooks-master-plan.md

Authoritative scope: unchanged owner-supplied master plan. Original baseline `c388cc8`. Current joined source is PR15, `f1718a9f1698a32181b594f83b82360f59645f16`; the parent's 67-file/361-test suite, production build and actual Windows J1/scripted check-in receipts are recorded in [integration evidence](evidence/integration.md). This is a partial checkpoint, not a complete product release. Repository review/fix/merge was separately authorized by the owner; Railway remains under its separate deployment owner and HOLD.

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
| T00 | established; core live gates partial | Public repo, pinned toolchain and disposable local PostgreSQL ready. Real model capability and installed selected-source gate passed; hosted app deployment and joined workflow remain open |
| T01 | complete for dispatch | Shared strict schemas/client and golden fixtures verified; independent review findings fixed with regressions. Frozen commit supplied in lane dispatch |
| T02/T03/T08 | implemented, reviewed and joined | PostgreSQL/HTTP/SSE/restart/resilience checks pass. Real tool/result/proposal capability passed; full generated-app J2 launch was blocked before execution |
| T04/T05/T07 | implemented and reviewed; installed source gate passed | Actual Windows main, safeStorage and persistence pass. The real installed observer detected two fresh items on one dedicated harmless source with export OFF and verified process cleanup. Physical tray withdrawal and durable journal/ingest/manager J3 remain open. No private archive scan |
| T06/T09 | implemented, reviewed and joined; native scripted subset passes | Trusted UI owner edits/reload/restart and actual pet Recorded pass with a scripted canonical question. Full model/source-driven J4 and visual/input acceptance remain open |
| T10/T11 | integrated; partial acceptance | 361 tests, typecheck and cloud/web/desktop build pass. J1 and a scripted question subset passed natively; J2 is blocked by automatic launch approval, J3/full J4/J5 remain open |
| T14 | in progress | Parent owns this evidence checkpoint. Parallel source-launch/artifact preparation is active; no final demo, recording, portable package or hosted joined artifact is claimed |
| T12/T13 | deferred | Core gates first |

## Independent review

- Read-only contract preflight identified check-in revisions, incomplete source client surface, local/cloud DTO separation, and fixed panel references. Accepted into foundation.
- Independent code reviewer found seven Important contract issues. Fixed all: observation kind/metadata/provenance/excerpt agreement, server-derived model task authority fields, required revision signatures, complete safe errors, exact `until` snooze input, accepted-only job receipts, and a valid-baseline privacy regression. Negative regressions were observed red then green. No live/source/native assertion follows from that review.
- Independent transport/security reviewer found missing receipt-hash and record-scope validation. The client now binds receipts to exact path/normalized command plus known result identities, covered by negative regressions. Redirects are denied, response/SSE frames bounded, authorization confined to injected main transport, and fixture fallback is never automatic.
- Independent build reviewer found weak acceptance validation. Regressions first demonstrated unsupported live-vs-fixture mode, missing evidence/revision, and unknown/incomplete case inventories accepted; all now fail. Acceptance references must exist in the declared commit. The checker validates references and inventory, never executes the claimed acceptance.
- Native helper results are acknowledged and retained. The native API supplies no T3 task ID/child thread handle to archive. Prepared T3 implementation children will use the requested completed-task confirmation and recoverable archive flow.

## Live gates

The real standalone adapter probe passed on `nvidia/nemotron-3.5-lightning-30b-a3b` at `https://integrate.api.nvidia.com/v1` with three HTTP 200 submissions; its private Build credential is not repository content. Full-app J2 remains NOT RUN: automatic approval rejected the explicitly bounded launch with only `blocked by policy` before execution. No request was sent and the separate J2 database remains unused; do not retry the rejection through another path.

Railway PostgreSQL is provisioned under the separate deployment owner's custody; its application is not deployed, and deployment configuration PR12 is not a verified pinned joined artifact. Local Docker PostgreSQL is disposable test infrastructure. A newly created harmless build-test source was selected by exact vendor identity and cwd, with explicit local-read consent and export OFF. Pinned Codex CLI 0.166.0 read-only App Server history automatically produced two fresh persisted item observations, with actual latency/provenance and reader process cleanup recorded in [live observer evidence](evidence/live-observer.md). Any other source needs its own selection/consent; metadata mode does not itself authorize local message-content reads. Durable journal/ingest/manager J3 and all export paths remain unaccepted.

Only A04, A09 and A10 are currently marked passed in the acceptance matrix, in live capability/observation mode. Passing unit/integration suites and the scripted native question do not silently accept the other scenarios. Original startup incident cause remains unproven; the reviewed lifecycle fix and the successful later native runs are recorded separately. The separate frontend redesign and its later native/usability acceptance are outside these receipts.
