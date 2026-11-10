# Sendblue runtime lifecycle seam

The runtime in `apps/cloud/src/integrations/sendblue/runtime.ts` is a one-shot,
explicitly enabled, injected scheduler. It calls at most one `tick` at a time
per runtime, passes its abort signal, waits for the active tick on stop, and
never starts again after stop. Failures are reported without exposing the
exception, then polling resumes. It performs no database or network work itself.
A tick that ignores abort can delay shutdown indefinitely: the owner must keep
its database alive until stop resolves, or implement a separate process-level
shutdown policy without treating an unfinished tick as safely completed.

## Parent integration patch (not applied)

After PR45's independent review and any corrections, integrate against its exact
final head. With the same captured `phoneConfig` passed to the API and queue,
construct one `SendblueDelivery(pool, phoneConfig)` and one runtime. Supply
`enabled: capability(phoneConfig).available`,
`tick: signal => delivery.tick(signal)`, and a sanitized `onError` callback.
Start it once during successful service startup. During all shutdown and
startup-failure cleanup paths, stop it and await it before closing the database.
Replace PR45's existing `startSendblueDispatcher` call rather than running both
dispatchers. Coordinate the ordering with the owner's other startup/shutdown
changes; these shared files are outside this worktree's ownership.

The injected delivery must retain PR45's durable claim, generation, final
owner/project/link authorization, STOP/revoke serialization and uncertain-send
handling. This scheduler is not a cross-process lock, an authorization check, or
an idempotency mechanism. Aborting cannot retract a provider request that has
already started; any ambiguous outcome needs durable reconciliation and must not
be automatically resent. Configuration is captured at startup; runtime STOP and
revoke require the delivery layer's durable guards. Do not enable this path until
those invariants and the parent integration are independently verified.

## Evidence and limits

Starting clean checkout: HEAD `6f43f2bc728bfb7193d1c7c44ab979a1865e048e`;
PR45 inspected at `c9d266e3d7cc8a2604fcee8578b992f814ddcf74`, whose base is
`3bcfb5b2ee08e1d8d26fa6aacd9636154b9ca45d`. Only new lifecycle, focused test,
and this evidence file are owned here. PR45 and shared startup were not edited.
The initial synthetic test run failed five assertions because the new runtime API
was absent. A second RED exposed a timer interval overflowing Node timers; the interval is now bounded. The focused suite exercises default-off behavior, serial polling,
repeated start, abort and shutdown waiting, no queued work after stop, and
sanitized error reporting/recovery with fake timers and injected functions.
It does not verify PostgreSQL locks, PR45 delivery, actual revoke or STOP,
cross-process duplicate prevention, provider behavior, deployed messaging, native
UI, live T3, credentials, or a real phone. No sockets are opened by these tests.
