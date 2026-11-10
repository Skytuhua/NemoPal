# NemoPal proactive background reviews

The owner wants NemoPal to continue authorized unfinished work, identify blockers,
provide useful progress check-ins, and suggest the next useful step without
waiting for another message. Background schedules should stay out of the project
task list, while remaining inspectable and pausable.

## Approach

Reuse the existing PostgreSQL manager queue and cloud check-in dispatcher. A
persisted, explicitly enabled schedule queues a bounded manager reflection when
due. This keeps the existing model, proposal validation, coding consent, and
desktop presentation controls authoritative. A second T3 scheduler would wake
the coding assistant rather than the NemoPal manager; a desktop-only timer would
stop when its window closes. Neither is the intended implementation.

## Behavior and builder defaults

- One durable schedule per project, controlled through authenticated GET/PUT
  endpoints. The default interval is 30 minutes, bounded to 30 minutes–24 hours.
- Use the owner's timezone and quiet hours. At most three scheduled reviews per
  rolling 24 hours across the owner, at least one hour apart.
- Skip inactive projects, unavailable/expired credentials and pending/running
  manager jobs. Observe pending/claimed/unknown coding requests as possible
  blockers, but suppress additional coding requests at commit. No catch-up burst
  on restart.
- Skip when nothing actionable has changed since the previous scheduled review.
  Track owner input, task details/drafts, authorized evidence, and coding outcomes rather
  than the manager's own replies or project timestamps.
- Reviews inspect progress and blockers, choose a useful next step, and may
  request existing consented coding work. A review does not grant new coding,
  source export, phone notification, or external-action permissions.
- Reserve the last owner model call: admit a background review only with enough
  remaining allowance for its existing four-call ceiling plus one owner call.
  Existing per-call token/call reservations remain authoritative.
- No new chat message is fabricated as owner input. Background intent is explicit
  job metadata; conversation context remains available without replaying an old
  owner request as a fresh command.
- A disabled schedule cancels its outstanding scheduled jobs without cancelling
  ordinary owner messages or source-triggered jobs.

## Scope

Changes reach the schema/migration, authenticated schedule routes, background
admission in the existing dispatcher, manager job contract and prompt, and focused
synthetic database/model tests. No new dependency or project-task UI is required.

## Current live boundary

The working demo is in `t3-f58898ac`, with concurrent local phone and response
changes. Preserve those edits and leave GitHub untouched. Live usage was verified
at 47/48 calls on 2026-11-08. Implementation and synthetic validation can proceed;
live model execution and a backend restart must not consume that last call.
The new budget guard will therefore keep proactive inference blocked until the
owner supplies additional finite allowance. No paid test calls or texts are part
of this change.

## Verification

Prove durable due admission and restart behavior, concurrent-tick deduplication,
owner isolation, revocation, quiet hours/caps, no self-trigger loop, coding-work
suppression, exhausted-budget behavior, disable/cancellation, and prompt context
with injected clocks and synthetic adapters. Run affected cloud/contracts tests,
typecheck, and a production build without starting or replacing the live demo.
