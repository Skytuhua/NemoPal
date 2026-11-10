# Proactive NemoPal reviews

NemoPal can run a persisted background review for an explicitly enabled project.
The schedule stays out of its project task list. Reviews can assess progress,
report blockers, choose next steps, and request coding through the existing
consented desktop session. They do not enable source export or phone notifications.

The cloud process must remain running. Defaults are a 30-minute eligibility check,
at least one hour between reviews and at most three reviews per rolling 24 hours
across the owner. Existing timezone/quiet hours apply. Unchanged inputs do not
cause repeated reviews; owner messages, task details, documents, source changes
and coding outcomes can make another review useful. Pending, claimed or unknown
coding work can be reported but cannot produce a duplicate scheduled request.
Failed reviews may try again after the same owner spacing and daily attempt cap;
a failed provider response does not count as a successfully reviewed input.

## Enable, inspect or pause

Use the existing paired owner's Bearer authentication. No additional token or
permissions are created. Send an authenticated PUT to
`/v1/projects/PROJECT_ID/proactivity` with a fresh operation UUID:

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "input": { "enabled": true, "intervalMinutes": 30 }
}
```

The interval must be 30–1440 minutes. GET the same endpoint to inspect
`enabled`, `intervalMinutes` and `nextRunAt`. PUT `enabled: false` with a fresh
operation UUID to pause and cancel outstanding scheduled jobs. Ordinary owner
messages and source-triggered jobs remain independent. Replaying the original
operation returns its saved receipt rather than changing the schedule again.

Enabling saves the exact enabling credential and device. Expiry or revocation
stops reviews. Re-pair and explicitly enable again to renew that authority.

## Model allowance

Reviews use the existing finite global model allowance. Admission/claim requires
enough calls for the remaining four-call job ceiling plus one owner call. Each
HTTP call atomically preserves that final owner call; existing token limits,
provider checks, job leases and proposal validation still apply. Missing model
capability or allowance leaves the schedule dormant. Restart resumes the stored
due state without creating a catch-up burst.

## Evidence

`tests/cloud/proactivity.test.ts` uses the dedicated disposable test database,
injected clocks and synthetic model responses. It covers schedule controls,
restart/concurrency, quiet hours/caps, budget exhaustion, disable during inference,
stale replacements, duplicate coding suppression and fresh-input races. Those
checks do not establish live provider, native display or phone delivery behavior.
