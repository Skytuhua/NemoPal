# Installed observer gate: live transport, harmless synthetic content

Executed by the parent on Windows, 2026-11-08 UTC. Result: **PASS** for the
read-only selected-source gate, with two fresh persisted items. This does not
establish the journal -> ingestion -> manager -> evidence-card J3 workflow.

The exact gate source was reviewed PR30 commit
`ba23c1ddaaf739d464a3bb2188877f8de5d920c6`, SHA-256
`6a414a21f96c2a6f9402f7f3e868ba2549e7af280228a8a2b532864547523e5f`.
The gate, contracts and production observer are byte-identical in integration
commit `8b5fed24c0f5cd27458aad41a2b07613d62fa589`. The CLI used the actual pinned
installed Codex App Server observer, version **0.166.0**, and the private installed
attestation path rather than the injectable synthetic guard.

## Source custody and execution

The parent created one new harmless child conversation solely for this test.
That child reported only its own runtime-provided vendor UUID and prepared cwd;
there was no session/profile/archive discovery. The reader selected that exact
UUID and matching cwd, with explicit local-read consent and export policy OFF.
It enrolled the current tail with **zero backfill**. Actual UUID/path values are
retained privately; neither they nor message text enter this public receipt.

After the CLI emitted its safe `enrolled` event, the parent independently requested
ordinary harmless source replies. These caller actions were separate from the
observer. The reader's pinned `ReadOnlyRpc` permits only initialization and
selected-thread header/turn-history reads; no harness start/resume, input,
approval, interrupt or tool mutation was added or sent by the reader. This is
code-enforced request scope plus an actual installed run, not a packet capture or
a claim that App Server initialization performs no local log/state writes.

The direct CLI was launched from the selected source's cwd, using the reviewed
entry and its tsconfig, with:

```text
LP_LIVE_TEST_OPT_IN=1
LP_OBSERVER_LOCAL_READ_CONSENT=1
LP_SYNTHETIC_SOURCE_NAME=<the owned harmless fixture name>
LP_SELECTED_SOURCE=<that fixture's exact vendor UUID>
CODEX_THREAD_ID=<the same UUID>
LP_OBSERVER_WAIT_MS=120000
LP_OBSERVER_POLL_MS=1000
```

No product database/cloud/GUI, Nemotron credential/request or source export was
used. The existing root checkout and user-run J2 resources were untouched.
The content was deliberately synthetic; persistence, transport and provenance
were actually observed.

## Safe installed receipt

| Field | Observed value |
| --- | --- |
| Evidence / status / liveAcceptance | installed_source_observation / passed / true |
| Adapter | codex-app-server / 0.166.0 |
| Export / backfill | OFF / 0 |
| Baseline enrolled | true |
| Fresh distinct items / duplicate items | 2 / 0 |
| Reads | 57 |
| Elapsed / enrollment | 57762.3787 ms / 874.6393 ms after start |
| Stop grace / cleanup | 2000 ms / stopped |

| Item | Kind / evidence level | Detected after enrollment | Source-to-detection latency |
| --- | --- | --- | --- |
| 1 | user_visible_message / user_reported | 53829.0834 ms | 652 ms |
| 2 | assistant_report / agent_reported | 56886.7583 ms | 935 ms |

Item identity SHA-256 values:

```text
53e6c740ffdadd6ec6cd65edd327d5b8b763c4e42f5e4ba91badfaafdebe4fa3
7787d43ab85a4d2d58ae3f8b120adaff5b40449bc3a901f9ddbd983aa76becaa
```

Revision SHA-256 values:

```text
c4f0baf4b40051fbc71595109ac27a032385bf9649bdaa6d21a5ebf3456daf6f
20b51791cc0e0281afc692018963aeccf57b6fe68076ee26e0001579e88f5f54
```

The process exited 0. The parent captured the exact reader Node and its App
Server child while enrolled, then separately confirmed both process IDs were
absent after completion. No other Codex/application process was stopped.
Completed producer task results were received/acknowledged, confirmed completed
with result_available and no pending children, and recoverably archived.

The two counted items are the kinds shown above, not two assistant replies or
independently verified tool checks. A later harmless producer reply is outside
this receipt and adds no claimed observation. No task completion, cloud upload,
manager interpretation, evidence card or native UI outcome follows from this
gate. J2, full J3/J4/J5 and final demonstration remain separate requirements.
The bounded-history/version/clock limitations in
`observer-gate.md` still apply.
