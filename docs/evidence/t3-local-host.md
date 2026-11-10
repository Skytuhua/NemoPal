# Local T3 host control

This is an opt-in backend seam, not a completed desktop integration or a verified live connection. It exposes authenticated controls only on a loopback cloud listener. The owner must explicitly select a current source, task, T3 environment/project/thread and run, and consent to local read access. No remote question answer or permission approval is provided. Questions and permissions must be handled in T3. Do not retry or bypass a previously rejected authorization page.

## Operator path

1. In a private terminal in this checkout, configure `DATABASE_URL` for the owner's local database and `PUBLIC_ORIGIN=http://127.0.0.1:4310`, run `pnpm db:migrate`, then set `LP_LOCAL_T3=1` and run `pnpm dev:cloud`. The flag is refused for a non-loopback origin. Use an existing paired device's bearer credential; keep it and the T3 authorization link private. The ordinary pairing operator command is `pnpm owner:grant` with `LP_OWNER_TIMEZONE` set; redeem its one-use code through `/v1/auth/redeem` if a device is not already paired.
2. Use the authenticated `/v1/projects` and `/v1/projects/{projectId}/snapshot` endpoints to select an active project and an existing task. The task must already exist. Enroll a source using the existing `/v1/projects/{projectId}/sources` command with `adapterId: "t3"`, `capability: "incremental_history"` and `exportPolicy: "metadata_only"`, or select an existing following T3 source owned by that device. Snapshot supplies its `id` and `grantRevision` and the task's `id` and `revision`. Retrieve the current counters using `GET /v1/local/t3/revisions/{projectId}/{bindingId}` with the same bearer credential.
3. `POST /v1/local/t3/start` with the same credential and JSON below. Replace every placeholder with the owner's actual selections, current revisions and an expiry in Unix milliseconds no more than 24 hours ahead. `startPosition` must be an explicitly chosen position for the selected thread, and `runId`/`runOrdinal` must identify the selected current run. The endpoint is the owner's supported same-machine `http://127.0.0.1:<port>/mcp`; no default is inferred. The literal `localReadConsented: true` is the owner's consent for this selection, not a substitute for T3's own authorization.

```json
{
  "projectId": "PROJECT_ID",
  "bindingId": "SOURCE_BINDING_ID",
  "endpoint": "http://127.0.0.1:PORT/mcp",
  "enrollment": {
    "sourceGrantRevision": 0,
    "expectedT3GrantRevision": 0,
    "expectedMappingRevision": 0,
    "taskId": "TASK_ID",
    "taskRevision": 0,
    "environmentId": "T3_ENVIRONMENT_ID",
    "t3ProjectId": "T3_PROJECT_ID",
    "threadId": "T3_THREAD_ID",
    "startPosition": 0,
    "runId": "T3_RUN_ID",
    "runOrdinal": 1,
    "expiresAt": 1900000000000,
    "localReadConsented": true
  }
}
```

4. Query `GET /v1/local/t3/status` with the same device credential. While sign-in is pending it can return `authorizationUrl`. Only the owner may open and decide on a permitted T3 authorization; this implementation never opens or approves it. The service reports the selected mapping and, after a successful observation and canonical commit, bounded activity metadata. `starting`, `unavailable`, an absent activity, or a successful HTTP request is not evidence of a live connection. The actual T3 approval flow remains subject to its existing policy restriction.
5. `POST /v1/local/t3/stop` with the same credential and await the response before stopping the cloud. Normal cloud shutdown also awaits cleanup. Existing source pause/revoke controls remain authoritative. If the host crashes, its database fence remains, and another start is blocked. If cleanup is unconfirmed, no automatic recovery or deletion of the fence is offered; the owner must first establish the remote session and client approval are closed, then obtain a reviewed recovery procedure. Do not delete the fence simply to force reconnection.

For example, from a private PowerShell session, with a paired token already held in `$deviceToken` and the edited start JSON held in `$start`, the actual requests are:

```powershell
$headers = @{ Authorization = "Bearer $deviceToken" }
$base = 'http://127.0.0.1:4310'
Invoke-RestMethod -Headers $headers "$base/v1/projects"
Invoke-RestMethod -Headers $headers "$base/v1/projects/$projectId/snapshot"
Invoke-RestMethod -Headers $headers "$base/v1/local/t3/revisions/$projectId/$bindingId"
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' -Uri "$base/v1/local/t3/start" -Body ($start | ConvertTo-Json -Depth 8)
Invoke-RestMethod -Headers $headers "$base/v1/local/t3/status"
Invoke-RestMethod -Method Post -Headers $headers -Uri "$base/v1/local/t3/stop"
```

The source enrollment command uses the usual revisioned envelope: `{ "operationId": "<new UUID>", "expectedRevision": <snapshot project revision>, "input": { "sourceKey": "<owner chosen source key>", "adapterId": "t3", "adapterVersion": "1", "capability": "incremental_history", "exportPolicy": "metadata_only" } }`. Do not put real tokens, URLs, IDs or command output in a tracked file.

The control API is a presentation seam for a trusted local client; no desktop UI has been wired here. It does not ingest task completion or provide a remote answer/approval operation. Treat API output and identifiers as private.
