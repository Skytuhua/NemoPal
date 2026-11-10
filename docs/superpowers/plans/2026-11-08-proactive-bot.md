# Proactive bot implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the NemoPal manager durable, quiet background reviews without duplicate coding work or expanded permissions.

**Architecture:** Reuse the existing cloud dispatcher and manager queue. Authenticated per-project schedules admit explicitly tagged jobs under existing owner/project locks; model reservations retain one call for the owner.

**Tech stack:** TypeScript, PostgreSQL, Zod, Vitest; no new dependencies.

**Spec:** ../specs/2026-11-08-proactive-bot-design.md

## Global constraints

- Preserve concurrent edits, protected profiles, live database and finite allowance.
- No GitHub updates, live model calls, texts or backend restart.
- Reviews may observe pending coding work but must not issue duplicate requests.
- Use coding state `unknown`, never automatically retry its work.

## Review focus

- Concurrent schedules must serialize owner limits and deduplicate project jobs.
- Revoked or disabled schedules must fence queued/running scheduled work.
- Stale retries must retain their scheduled kind and budget protection.
- Manager output must not trigger endless reviews; fresh owner input must survive.
- Pending/claimed/unknown coding requests must still be reportable as blockers.

## Task 1: Persist schedules and admit due reviews

Files: contracts/model.ts, cloud/db/schema.sql, cloud/checkins/proactive.ts,
cloud/api/server.ts, cloud/checkins/scheduler.ts, cloud/application.ts,
cloud/domain/store.ts and tests/cloud/proactivity.test.ts.

- [ ] Add failing API/admission tests using the disposable test database.
- [ ] Add bounded authenticated GET/PUT schedule controls and durable due state.
- [ ] Admit tagged jobs with quiet hours, owner limits, budget and input fences.
- [ ] Connect admission to the existing dispatcher; delete schedules with project data.
- [ ] Verify API isolation, replay, restart, concurrency, limits and disable behavior.

## Task 2: Execute scheduled reviews within existing authority

Files: cloud/jobs/queue.ts, cloud/jobs/worker.ts, cloud/jobs/model-settings.ts,
nemotron/adapter.ts, nemotron/runner.ts and tests/cloud/proactivity.test.ts.

- [ ] Test scheduled conversation context and atomic protection of the last call.
- [ ] Preserve scheduled kind through stale retries and fence disabled schedules.
- [ ] Pass explicit review intent to the model and retain recent conversation.
- [ ] Suppress duplicate coding requests at commit and refresh consumed fingerprint.
- [ ] Run focused cloud/contracts checks, full serial tests, typecheck and build.
- [ ] Obtain independent code/security review and fix actionable findings.

## Delivery

- [ ] Document schedule controls and live activation limit.
- [ ] Report tested local behavior separately from unactivated live behavior.
