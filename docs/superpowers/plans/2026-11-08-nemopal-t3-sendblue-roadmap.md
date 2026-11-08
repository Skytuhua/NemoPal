# NemoPal T3 Code and Sendblue capability roadmap

This coordinator's planning record only. The user reports active implementation in side-chat agents; main owns the interface and must not duplicate those edits. Dice UI itself does not implement these integrations.

## Requested outcome

The owner selects a project/thread to observe. The mapped board card shows a real active/stale/offline indicator, with an accessible status and reduced-motion equivalent. Task completion can be automatic only when a configured reliable task-success rule is met. Genuine human questions/approvals are presented through the pet and authorized phone channel, and a human response is correlated to the exact pending request where a supported response API exists.

## Verified T3 boundary

The inspected official v0.1.7 documentation and current tool metadata establish:

- Project/thread list/read and bounded activity paging exist. Reads are not automatically project-scoped grants; NemoPal must enforce the exact selected environment/project/thread allowlist.
- Visible history can include inherited/synthetic material with sourceThreadId/visibility. Do not follow parent/source links automatically. Explicit history/export consent must cover what will be read and sent to Nemotron; enrollment metadata alone grants no transcript export.
- Timeline paging is not a documented event subscription. Polling must refresh changing status, reconcile reconnects and show stale data honestly.
- `task_status` is restricted to tasks started by its calling parent. It is not a general arbitrary-thread business-task-success oracle.
- `t3_pending_request` lists/reads/answers questions. Its contract explicitly says approvals are not listed and responding cannot approve a permission request.
- Internal application contracts contain `runtime-request.respond`, but that does not establish an authenticated, supported outside-agent approval API. Live/message/not_resumable distinctions matter; saved approval records may outlive callbacks.

Official references:

- https://github.com/pingdotgg/t3code/blob/v0.1.7/docs/orchestration-v2/orchestrator-mcp-server.md
- https://github.com/pingdotgg/t3code/blob/v0.1.7/apps/server/src/mcp/toolkits/thread/tools.ts
- https://github.com/pingdotgg/t3code/blob/v0.1.7/packages/contracts/src/orchestrationV2.ts

## Separate directions of MCP integration

1. A small NemoPal stdio MCP bridge lets an authorized coding agent read one project brief and submit bounded agent-reported progress. Use a revocable project-bound token, not cloud credentials. Preserve unrelated T3/Codex configuration; restarting the agent session may be necessary.
2. NemoPal observing T3 is a separate adapter/grant. It must not impersonate the Codex observer or treat MCP installation as permission to read all threads.
3. Neither direction grants permission to resolve native permission approvals or bypass a policy denial.

## Required identity and persistence

- Source binding: owner/device, environment/project/thread IDs, grant revision, enrollment point, history/export policy and revocation state.
- Task mapping: canonical task ID/revision, mapping revision and exact T3 run/task IDs. A thread can finish without its task succeeding.
- Completion rule: explicitly enabled owner policy plus reliable correlated success receipt/criteria. Assistant prose, a stopped run or a child completed flag alone leaves the task for review; it cannot silently set done.
- Attention request: exact environment/thread/run/request IDs, type, offered decisions, current response capability, action digest, expiry and grant revision.
- Human response: authenticated owner/channel identity, one-use correlation/challenge, idempotent operation ID and separate received/delivered/resolved states. Never send an approval as ordinary chat and claim it resolved a native request.

The activity ring must show real current metadata, not fictional progress percentage. It stops/reduces motion under OS/local settings and exposes text for screen readers. Revocation, stale mappings, resumed/replaced runs and missing receipts clear/fence the corresponding actions.

## Sendblue adaptation

Use the supplied plan's cloud-first canonical workflow, adapted to Sendblue. Preserve messages, queued jobs and outbox intents transactionally; do not create a second independent project/task database.

- Outbound API pair: sb-api-key-id and sb-api-secret-key. Ordinary message webhooks document a separate sb-signing-secret shared secret; do not substitute the Verify product's HMAC format.
- Bind configured account, receiving line, authorized sender and one project/link. Reject cross-account/line/sender, groups/media/echoes unless separately implemented.
- Deduplicate inbound message_handle with payload hashes. Persist accepted inbound message/job atomically, and outbound intent with canonical manager commit.
- Ordinary send documentation does not establish general text idempotency. After possible transmission with a lost response, mark uncertain and do not auto-resend. API acceptance is not delivery.
- Ordinary sends may fall back to SMS. Do not promise an enforceable iMessage-only channel until provider capability is confirmed.
- STOP/revoke opt-out disables the link and pending work; START alone does not restore local authority. Recheck authorization immediately before transport after asynchronous waits.
- Generic yes/no text is not sufficient privileged approval authority. Bind the exact request/action and authenticated human; privileged decisions require an authenticated confirmation path supported by T3. Never infer decisions with Nemotron.

Primary contracts: https://docs.sendblue.com/security/ ; https://docs.sendblue.com/getting-started/receiving-messages ; https://docs.sendblue.com/api/resources/messages/methods/send ; https://docs.sendblue.com/getting-started/sending-messages .

## Work sequence and gates

1. Freeze board/task context and source/attention contracts; coordinate shared Store/queue/main files.
2. Build an injected T3 adapter and project-scoped bridge. Offline tests cover selected-thread enforcement, no inherited-link traversal, duplicate/out-of-order polling, stale/offline status, task mappings and revocation.
3. Add completion-policy tests: thread finishes unsuccessfully, task proof absent, old run receipt, changed task revision and revoked binding never complete a task. A valid correlated configured rule is the only automatic success path.
4. Implement Sendblue disabled/offline: webhook authentication, sender binding, canonical ingress, outbox leases, uncertain send, opt-out and restart/replay behavior. Never read credential files for fixtures.
5. Support exact pending-question answers through the verified API. Alert on permission requests without claiming response capability.
6. Before implementing permission-response transport, verify an official authenticated external API or approve a focused T3 extension. If unavailable, show Open in T3/manual resolution; do not invent a private endpoint.
7. Only after separate release: enroll one harmless selected thread, prove board activity/success, and test an authorized phone recipient. Actual pet/native behavior, transcript export, model calls and real pending-request round trips each require their own evidence.

No secret/account provisioning, existing private history reads, provider/phone calls, native launches or deployment occurred during this planning. The earlier policy-blocked J2 launch remains blocked and must never be re-created as a synthetic approval request.
