# Sendblue offline implementation ledger

Prepared checkout: `C:/Users/user/.t3/worktrees/NemoPlaybook/t3-a8919ed3`, branch `t3/a8919ed3`, HEAD `3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`. Starting tracked/untracked status clean. No other checkout modified.

Scope: disabled cloud transport, distinct finite phone authority, canonical ingress/manager/outbox, trusted notification port. Parent owns independent review and integration with T3. No child agents, live provider/phone/model, DB connection, GUI, credentials, deployments or merges.

Ruling: the attached Inkbox plan is provider-stale; current Sendblue primary contracts and the task brief govern. No Verify-product HMAC, undocumented idempotency header, or iMessage-only promise.

Ruling: use the prepared checkout and existing transaction/manager modules. The roadmap is planning context, not acceptance. Startup corrections parked elsewhere remain parent integration work.

Ruling: ordinary phone text grants only canonical message/manager/reply actions (and separately enabled trusted notices). It never approves local execution, source access, T3 permissions or task completion.

Ruling: phone grants last at most seven days and support only canonical chat plus existing manager proposals. Natural-language completion reports do not bypass the existing completion policy. Phone jobs do not enroll desktop reminder authority. Generic yes/no text remains chat. Cost: users must use authenticated existing controls for owner task actions and local/T3 approvals.

Ruling: the durable sending marker precedes transport. A final owner/project/link/lease guard starts transport while holding the owner lock, then immediately releases the transaction before awaiting the provider. This tiny initiation section is necessary to serialize STOP against transmission; provider/model waits never hold database locks. Cost: a crash or lost commit acknowledgement can conservatively classify an unsent intent as uncertain. No automatic resend.

## Production path

`owner link -> authenticated webhook -> Store.command -> appendOwnerMessage -> canonical messages + existing JobQueue -> canonical manager commit + reply intent -> SendblueDelivery`

- `PhoneAuthority` is a separate discriminated authority with no bearer credential or device identity. Server checks exact owner, project, account, line, sender, link revision, permitted action, active state, expiry and feature configuration at command/claim/context/commit/send. Existing desktop principals still use the credential path.
- Ingress receipt, canonical owner message, existing job, command receipt and event share one `Store.command` transaction. No nested message transaction. Provider handle is opaque; a deterministic operation UUID and a canonical payload hash protect replay. Mutable timestamps/diagnostic fields are excluded. Conflicting same-identity payloads return 409.
- Status transitions have separate durable receipts. Only a correlated outgoing handle can update delivery; an echo never creates a prompt. DELIVERED cannot regress to SENT. API acceptance remains `accepted`; it does not establish delivery. Unsupported nested/reply/attachment/group/reaction payloads are rejected.
- Manager reply correlation follows the immutable inbound owner-message ID through the bounded stale retry, including a reflection replacement. Ordinary desktop replies do not produce phone intents. One logical intent is unique for each link/input message.
- Outbox uses pending, leased, sending, accepted, delivered, failed, uncertain and cancelled states. Leases are 30 seconds with generation fences, one dispatcher tick every 15 seconds, a ten-second abortable transport/response limit and a 16 KiB response bound. Expired leased work can be reclaimed; expired sending work becomes uncertain. Lost responses, ambiguous errors and failed acknowledgement persistence never auto-resend.
- STOP/opt-out and authenticated revoke atomically disable the link, increment its revision and fence queued/running phone jobs and pending/leased/sending outbox entries. START does not restore authority; an authenticated owner must issue a fresh grant. Project deletion revokes links and clears outbox text. Changed project/source epoch, inactive project, grant expiry and revoke all block delivery.
- The existing runner receives at most eight canonical turns and 8 KiB of conversation, ending at the initiating owner input. Queue context explicitly reloads that canonical input if it falls outside the recent 200-message window, retaining the existing snapshot bound. Its system policy, model authority, tools, completion rules and shared contracts remain unchanged.

## Routes and schemas

| Route | Authorization and input |
| --- | --- |
| `GET /v1/integrations/sendblue` | Existing desktop bearer; state `disabled`, `unconfigured`, or `configured`, availability and truthful `iMessage_or_SMS` transport. Configured does not mean live verified. |
| `POST /v1/projects/:id/sendblue/link` | Existing desktop bearer, operationId/expectedRevision, strict input `{sender, expiresAt, notifications?}`. E.164 sender, expiry within seven days; notices default off. Returns a command receipt with link ID/revision/actions/expiry. One active sender/account/line binding and one active link/project. Fresh enrollment revokes the previous link. |
| `POST /v1/projects/:id/sendblue/revoke` | Existing desktop bearer, operationId/expectedRevision, strict input `{linkId}`. Can revoke even when the feature is disabled. |
| `POST /webhooks/sendblue` | Independent `sb-signing-secret` shared-secret check before parsing/storage. No desktop bearer exemption under `/v1`. HTTPS must be configured at the public edge. |

Webhook body is bounded to 16 KiB, text to 4096 UTF-8 bytes. Requires flat `accountEmail`, opaque `message_handle`, E.164 `from_number` and `to_number`, `content`, boolean `is_outbound`, supported `status`, `message_type: message`. Optional line/number/participants must match the same direct conversation. Inbound must be RECEIVED. Groups/media/reactions/nested extensions are unsupported. Process-local authenticated webhook admission is 120/minute; durable canonical ingress is ten messages/link/minute. Duplicates do not allocate another job. Storage failures return sanitized retryable 503 before acknowledgement; identity conflicts are 409. No payload, PII, provider error body, or key diagnostics are logged.

Tables added to the existing schema: `sendblue_links`, `sendblue_receipts`, `sendblue_outbox`. They reference existing owners/projects; canonical content and manager jobs remain in existing tables. Unique active mapping, receipt identity, operation/request/input identity, provider handle and due/rate indexes are declared in SQL. **SQL constraints, row locks, isolation, rollback and restart durability have not been verified on PostgreSQL.** The in-memory query fixture exercises production decisions and transaction boundaries, not PostgreSQL semantics.

## Configuration and enablement

Names only; no credential files were searched/read and no values are provided here:

| Name | Purpose |
| --- | --- |
| `NEMOPAL_SENDBLUE_ENABLED` | Defaults false; exact true is required to admit/deliver phone work. |
| `SENDBLUE_ACCOUNT_EMAIL` | Exact account identity accepted in webhook bodies. |
| `SENDBLUE_RECEIVING_LINE` | Exact account-owned E.164 line, also explicitly supplied as outbound from_number. |
| `SENDBLUE_API_KEY_ID` | Cloud outbound API key ID. |
| `SENDBLUE_API_SECRET_KEY` | Cloud outbound API secret, never webhook authentication. |
| `SENDBLUE_WEBHOOK_SECRET` | Separate ordinary-webhook shared secret. |

Existing `DATABASE_URL`, public HTTPS `PUBLIC_ORIGIN`, genuine Nemotron probe/budgets and owner authentication remain independent prerequisites. Environment configuration is captured at startup; disabling the flag requires restarting every replica. For immediate runtime revocation, use the authenticated revoke route or STOP. Disabled/unconfigured dispatchers perform no storage or transport work. No feature flag grants source or local permission.

Before enablement: parent independent code/security review; isolated PostgreSQL recipe below; integrate parked startup corrections and both modules; explicitly authorize deployment/model/phone work; configure public HTTPS and the separate webhook secret; verify actual Sendblue account/line/contact and any plan restrictions; explicitly grant the intended owner/sender/project and reply export; prove model availability. Configure account receive/outbound webhooks against the authenticated route. Receiving and sending guides describe account/contact restrictions; no provisioning or phone possession proof occurred here. Default remains OFF.

## Trusted notification port for parent

`NotificationEnqueue` / `enqueueNotification(pool, config, notice, now?)` in `apps/cloud/src/integrations/sendblue/outbox.ts` accepts exactly:

```ts
{ operationId, ownerId, projectId, kind: 't3_question' | 't3_permission_notice', requestKey, text, expiresAt }
```

This is an injectable in-process port, not a public route. Notices require the same active exact-scope link plus its explicit `notify` action; expiry is within the link lifetime and one day. Text is caller-supplied, at most 1600 UTF-8 bytes, with no transcript/source enrichment. Parent should supply only a neutral notice such as a question waiting in T3; do not put credentials/private transcripts in text. Operation and request-key replay is durable, conflicting content is rejected. Parent/T3 module owns request correlation, expiration and response handling. No T3 import, permission API, approval inference, or privileged yes/no mapping exists here.

## Personally run offline evidence

- Dependency install in this checkout only: `pnpm install --offline --frozen-lockfile --ignore-scripts`; 266 packages reused, **zero downloaded**; no tracked dependency/config/lock changes.
- Initial production-route RED: one test observed 404 instead of disabled 503; the expanded fifteen-case ingress batch failed against the original server.
- Additional meaningful RED/GREEN: nested attachments were accepted; changed source epoch still reached injected transport; expiry during job-row wait still returned context; the runner had no bounded conversation; cancellation left injected transport stuck. Each observed failure preceded its corrective implementation.
- Additional input-retention RED/GREEN: a queued owner's canonical input disappeared after 201 later messages; exact input reload now preserves it without expanding the 200-message contract.
- Final focused command: `pnpm exec vitest run tests/cloud/sendblue.test.ts tests/cloud/sendblue-context.test.ts tests/cloud/provider-send-authority.test.ts tests/cloud/adapter.test.ts --maxWorkers=1 --no-file-parallelism` -> **39 passed, four files, exit 0** on 2026-11-08. New Sendblue files account for 32 tests; the seven existing tests were inspected for offline imports before running. Coverage includes negative account/line/sender, unknown sender, signature isolation, safe errors, default off/unconfigured, replay/hash conflicts/lost webhook response/restart, atomic rollback, STOP/START/revoke/expiry/rate bounds, manager lineage and desktop non-delivery, unique outbox, stale generation/reclaim, uncertainty after lost response/acknowledgement/restart, status dedupe/echoes, source epoch, cancellation and scoped notices.
- `pnpm typecheck` -> **exit 0**. It initially caught a missing `probe` member on the new offline test adapter; the fixture now explicitly refuses probes. `git diff --check` -> exit 0. Tracked package/dependency/config/lock diffs -> empty. No full/cloud suite or database helper was run.
- Author self-review only. Parent explicitly owns independent code/security review. No children were started. No DB, native GUI, private transcript, real provider/model/phone, deployment or main-session messaging occurred. No build was needed; TypeScript compilation is the compile gate.

## Dedicated PostgreSQL verification recipe (NOT EXECUTED)

Only after the parent obtains separate DB authorization, use a new disposable local database owned by this test, synthetic data, injected model/fetch and no real Sendblue credentials. Never point the recipe at the held/shared database or use the existing destructive helpers against it.

1. Apply `apps/cloud/src/db/schema.sql` twice to the disposable database and verify all added indexes/constraints; prove existing desktop project/message/delete behavior with the feature off. Seed a synthetic owner, project and finite phone link through the production commands.
2. Send two identical authenticated synthetic webhooks concurrently using distinct pool connections. Verify one receipt, one canonical owner message, one manager job and one phone command receipt. Change content under the same handle and verify 409 with no extra rows. Kill/restart the API after COMMIT but before the caller receives its response, then replay it.
3. Force a transaction error separately after message insertion, job insertion, ingress receipt insertion and command receipt insertion; verify no partial canonical message/job/receipt/event/revision mutation. Repeat manager commit with errors at outbox insertion and after outbox insertion; neither reply nor intent may commit alone.
4. Compete two independent manager claimers and two delivery claimers. Verify generation/lease ownership and the existing global manager slot; old generations cannot commit/send. Run a stale phone turn beside an unrelated desktop reflection and verify input/retry lineage produces one reply intent.
5. Commit the sending marker, stop the worker before transport, expire the lease and restart. It must become uncertain with zero resend. Separately drop the connection after the fake provider received the request and after the fake response but before status persistence; restart must still not resend. Verify PostgreSQL's aborted-transaction behavior rather than the fixture's simulation.
6. Hold delivery before its final owner-lock/authority read. Commit STOP or authenticated revoke on another connection, release the wait and assert zero transport. Repeat with source-epoch change, project pause/delete, link expiry, stale generation and cancellation. Hold a fake provider response after initiation: STOP/revoke must proceed without waiting for that response, and late response persistence must not resurrect cancelled/uncertain work.
7. Replay status transitions out of order and with content/hash conflicts. DELIVERED never regresses, outbound events never allocate model jobs, and uncorrelated echoes are rejected. Verify notice owner/project/actions/expiry/request idempotency and unique constraints across restarts.
8. Inspect only synthetic counts/IDs/redacted states, not provider secrets or private payloads. Retain a scoped receipt identifying PostgreSQL version, exact commit, isolated database, personally executed commands and result. Destroy only that explicitly owned disposable database when authorized. None of these steps has run in this implementation task.

## Parent integration and remaining acceptance gates

- Small shared patches: server adds config option and route registration; Store extracts the common owner-message mutation, admits phone-only webhook authority, preserves phone retry correlation and revokes/clears transport content on delete; JobQueue accepts a distinct authority and adds transactional reply intent; main captures config, constructs the same manager with it and starts/stops the delivery dispatcher; runner adds bounded canonical conversation only. Apply these seams to the parent's current versions without overwriting its T3 or parked startup/shutdown changes.
- No public shared contract/API-client/dependency change was required. No T3 response seam was implemented. The parent must bind its trusted notices to the notification port and enforce its own exact request correlation/expiry; local/source permission approvals remain separate.
- Final live acceptance still requires authorized persistent hosting, verified DB restart/locking behavior, genuine Nemotron capability, actual public HTTPS/webhook configuration, a real allowed phone/contact/line, observed iMessage versus SMS transport, delivery status, two-turn context, and desktop-off/reopen canonical convergence. API acceptance, injected fetch and query fixtures establish none of those.
- Uncertain intents require explicit human/provider reconciliation; there is no automatic retry or invented idempotency guarantee. No iMessage-only enforcement is claimed. The older plan's direct natural-language task mutation is deliberately not introduced: existing model/task-completion authority policy is unchanged.

Primary contracts checked 2026-11-08: [ordinary webhook secret](https://docs.sendblue.com/security/), [inbound format](https://docs.sendblue.com/getting-started/receiving-messages), [webhook management](https://docs.sendblue.com/getting-started/webhooks/), [ordinary send API](https://docs.sendblue.com/api/resources/messages/methods/send), [sending/status/SMS semantics](https://docs.sendblue.com/getting-started/sending-messages).
