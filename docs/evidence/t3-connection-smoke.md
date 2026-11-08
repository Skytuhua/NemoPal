# Dedicated local T3 connection check

Implementation ledger; no live connection has been attempted or established here.

## Custody and plan

- Prepared cwd: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-a86d7be3`.
- Prepared branch/HEAD: `t3/a86d7be3`, `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`; initial status clean.
- Leaf branch: `t3/t3-local-mcp-connect`, created in this prepared checkout at immutable PR46 head `9612f5cc8b8a41849260142a52fec126011d006c`. No worktree creation or edits in the author/parent checkouts.
- Ownership: new `apps/cloud/src/integrations/t3/client/**`, `scripts/t3-connect.ts`, `tests/cloud/t3-client*.test.ts`, this document, and required dependency manifest/lock edits only. Preserve all eight PR46 files byte-for-byte, including protocol/model/observer/attention.
- Read the exact PR46 evidence and the read-only readiness report at `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-cbbd978a/.tmp/reviews/t3-live-connection-readiness.md`.
- Use Superpowers test-first/verification, Ponytail minimal scope, and security standards. This implementation child does its own work, starts no children, sends no other-agent messages, and leaves independent review to the parent.
- Plan: write focused failing boundary fixtures; install a pinned official SDK without lifecycle scripts; implement finite public OAuth + ephemeral loopback callback + real MCP initialize/tools/list; run only focused fixtures and typecheck; self-review and publish a draft stacked leaf.
- The endpoint is supplied privately at runtime via `--endpoint`. Parent reports successful public discovery; this child will not query the actual server, register there, exchange real tokens, or invoke its tools. No actual machine address, identifiers or authorization receipt belongs in this document.
- Optional selected-thread read is omitted: the protected adapter currently uses wider limits than this smoke's required `limit:1/runLimit:1`. Main app enrollment/registration, durable credentials, canonical grants, polling, questions/permissions, board/pet/Sendblue wiring and actual user acceptance remain open.

## Primary sources consulted before implementation

- [Official SDK client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/client.md): `Client`, Streamable HTTP, and OAuth helpers.
- [Official SDK OAuth implementation](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/client/auth.ts): public registration, S256 authorization and code exchange. Pin the installed release; do not implement OAuth or MCP framing by hand.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): resource binding, PKCE, issuer discovery and loopback redirect protections.
- [Pinned T3 outside-client guide](https://github.com/pingdotgg/t3code/blob/af65a55dc77f7a2adaae28a9a80032a2f4d61da1/docs/user/outside-agents.md) and [OAuth source](https://github.com/pingdotgg/t3code/blob/af65a55dc77f7a2adaae28a9a80032a2f4d61da1/apps/server/src/auth/McpOAuth.ts): public client, exact local issuer/resource and read-only scope. Current source sends `iss` in its authorization response; an older installed server without it must fail closed.

## Delivered command and safety boundary

`scripts/t3-connect.ts` imports the real backend connector directly. No imports register it in cloud main/API, desktop or renderer. It uses the official SDK's public registration, S256 authorization/code exchange, `Client`, and `StreamableHTTPClientTransport`. The SDK is pinned to `1.32.2` in the cloud manifest and lockfile; existing dependency versions are unchanged.

The explicit endpoint must be canonical `http://127.0.0.1:<port>/mcp`. Hostnames, remote addresses, credentials, queries, fragments and alternative spellings are rejected before any send. Discovery requires this exact resource and issuer; authorization/token/registration routes must match the fixed T3 routes on that origin. All HTTP redirects are rejected. The public client name is `NemoPal local connection check`; the requested and accepted token scope is exactly `orchestration:read`.

The callback listens only on `127.0.0.1`, on an OS-assigned ephemeral port, for this finite operation. Independent random state and callback-path nonce bind the attempt. Exact host/path, unique parameters, issuer, state, code/error exclusivity and single use are checked. Responses contain fixed text, no redirect or reflected values. A server that omits `iss` fails closed. The CLI prints only safe progress, the necessary private local authorization link, and a sanitized result. It never opens a browser or enters/approves a pairing code.

The complete check has a 180-second deadline, with at most five seconds per HTTP/MCP request; tests may shorten these limits. Response bodies are limited before parsing to 64 KiB for OAuth/metadata and 256 KiB for MCP, including chunked/SSE data. Each permitted action is sent at most once: two discovery GETs, one registration, one code exchange, initialize, initialized notification, one optional SDK background GET, one tools/list, and session DELETE if a session ID exists. There are no auth retries, scope escalation, tool calls, pagination, resumptions or operation replay. SIGINT/SIGTERM cancel the same operation. Callback sockets, requests, SDK transport and any returned MCP session are closed; failure after an attempted registration/token/session request is conservatively `uncertain`, while pre-send/discovery rejection is `known_unsent`. Cancellation may prevent confirmation of remote session termination; it never triggers another sign-in or replay.

Tokens, client registration, authorization code and verifier exist only in process memory and are discarded at exit. JavaScript strings do not offer guaranteed memory zeroization. No credential store, environment file, global MCP profile, tunnel, remote configuration or account system is added. An approved T3 client may still appear in Sharing & access after exit; the operator can revoke that dedicated approval manually. The receipt omits the endpoint, machine/environment/project/thread IDs, server names, descriptions, returned instructions and credentials. It is still runtime evidence: keep actual output private and never commit it.

## Personally run validation

- `pnpm --filter @living-playbooks/cloud add @modelcontextprotocol/sdk@1.32.2 --save-exact --ignore-scripts`: succeeded. Public npm registry resolution/download access was required; pnpm reported 260 packages added, but did not provide a final download count, so no zero-download claim is made for this step. No lifecycle scripts ran.
- `pnpm install --offline --frozen-lockfile --ignore-scripts`: restored remaining workspace dependencies; 89 reused, zero downloaded. The first typecheck exposed dependencies omitted by the filtered install, plus one fixture typing cycle; both were resolved without UI/source/manifest changes outside ownership.
- RED: with an empty additive export, `pnpm exec vitest run tests/cloud/t3-client.test.ts --maxWorkers=1 --no-file-parallelism -t 'exports a real finite connector'` failed the expected function assertion. A preceding missing-module run was setup evidence only.
- Behavioral RED/GREEN: an authorization-link handler that never settled initially exceeded the test timeout despite the sign-in deadline. A cancellation-aware wait fixed it. A stalled MCP request initially reported `mcp_error`; it now reports `deadline`.
- Final `pnpm exec vitest run tests/cloud/t3-client.test.ts --maxWorkers=1 --no-file-parallelism`: **49 passed**, one focused file. Real test-owned ephemeral localhost HTTP servers exercise SDK OAuth and JSON/SSE framing, correct/rejected PKCE, wrong/missing state or issuer, denial/error, replay, endpoint/discovery/redirect/registration rejection, oversized fixed/chunked/MCP bodies, MCP error/missing tools, deadline/cancellation, callback closure, session DELETE/cleanup failure, secret-safe errors and CLI argument handling. No production endpoint is embedded in fixtures.
- Final `pnpm typecheck`: passed.
- `pnpm exec tsx scripts/t3-connect.ts --help`: passed without network access.
- `git diff --check`: passed. Comparison against all eight named PR46 files produced no differences; protected bytes remain unchanged. Final immutable leaf HEAD/tree and clean status are supplied in the parent handoff/PR because a commit cannot contain its own hash.
- Pre-push changed-file audit: eight owned changed files only; all eight PR46 files matched the pinned object's raw bytes. A focused pattern scan and manual review found no private endpoint/port, machine/target UUID, credential-shaped value, literal authorization capability URL or nonloopback listener. The scan printed category/count results only, never matched content. This is a limited changed-file audit, not independent security approval or a guarantee against every secret format.

These are synthetic fixture and static checks, not a live connection or independent review. No actual discovery, registration, token exchange, tool call, history read, provider/model call, texting, full/cloud suite, build, native/DB/VM/Railway/deploy, or blocked J2 path was run. Parent owns independent review and any authorized real run.

## Parent reproduction after independent review

Independent review found two session-cleanup defects. A refused HTTP 405 termination no longer produces a confirmed-closed receipt, and an established session is terminated even if the SDK closes its transport after a failed initialization notification. Cleanup uses one bounded authenticated DELETE, preserves the original failure, and sends nothing after cancellation. Two regression cases failed before the correction; the focused suite passed with those cases and a cancellation control. No live T3 connection is claimed.

A subsequent recheck found that a per-request deadline could still trigger cleanup. A regression reproduced the extra DELETE; cleanup now sends nothing after either a request or overall deadline. Ordinary initialization failures still receive the single bounded cleanup attempt.

A further recheck found that a server JSON-RPC error can share the SDK's timeout code. The connector now tracks its own deadline independently: a prompt server error is reported as an MCP error and receives bounded cleanup, while an actual local deadline still suppresses new sends. Focused synthetic cases cover both paths.

1. Install the locked dependencies in the selected checkout without lifecycle scripts: `pnpm install --frozen-lockfile --ignore-scripts`.
2. In a private local terminal, run `pnpm exec tsx scripts/t3-connect.ts --endpoint '<YOUR_LOCAL_MCP_URL>'`. Supply the copied same-machine URL at runtime; do not put it into tracked scripts or docs. There is no default address or port.
3. Open the printed local authorization link yourself. Verify `NemoPal local connection check` and the local return destination, explicitly choose **Read only**, then approve in T3. If requested, enter the pairing code only in T3. No agent should enter it or approve for you. If `iss` is missing, stop and update/review compatibility rather than weakening the callback check.
4. Success means OAuth plus MCP initialize and one tools/list succeeded, expected read tools were advertised, and transport/session cleanup completed. It proves no selected environment/thread identity, history read, task success, or continuing application integration. Errors print fixed messages and `known_unsent`/`uncertain`; never retry an uncertain attempt automatically.
5. Keep the authorization link and actual runtime output private. If a receipt must be saved, use ignored `local-data/` and confirm `git check-ignore` for its exact path first. Do not capture real links, IDs, credentials or receipts in GitHub evidence. Revoke the dedicated client in T3 Sharing & access after the demo if desired.

The optional selected-thread read remains omitted. A later separately reviewed join must use canonical scoped authority and the required one-item/one-run limits before reading an explicitly selected nonsensitive target. Main application registration, durable credential storage, board/pet display and human question/permission return remain unimplemented. This child does not archive itself; the parent owns result acknowledgment, terminal task-status confirmation and recoverable archiving.
