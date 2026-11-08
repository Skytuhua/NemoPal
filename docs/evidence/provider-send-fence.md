# Provider send authority after reservation

Parent correction of T11 finding F2 at integration
`f16537bdc0d7fcc5c9e92e76fedd4ab98e1c0956`.

The prior runner checked job authority before adapter entry, then the HTTP
adapter awaited durable account reservation. Revocation during that await could
allow a new request containing a previously read excerpt. Final commit fencing
prevented publication but could not undo that new disclosure.

Meaningful RED: a recording-only transport observed a continuation containing
the synthetic withdrawn excerpt after a held reservation completed. A second
test showed cancellation during reservation still initiated transport. The
current-authority control passed. No real provider, source or database was used.

The HTTP adapter now offers a job-scoped view whose closure shares the same
adapter/account counters and reservation function. `runJob` supplies its actual
`queue.context(job)` fence. After reservation, the adapter rechecks that authority
and abort state immediately before fetch. A denied send remains charged; no
allowance is refunded, reset or replenished. Per-call, per-tool and final commit
checks remain in place. Startup capability probes contain synthetic data and
retain their existing path and budget. No shared contract/DTO signature changed.

Tests exercise the real runner, HTTP adapter and worker with recording-only
provider ports and an injected queue authority predicate, not PostgreSQL locking
or a live provider. They cover revocation/cancellation during reservation, an
authorized continuation, independent job guards, and one shared charged budget
across scoped views. This does not claim recall of requests already transmitted.
The separate T11 desktop upload/session findings remain open until their own
correction; full J2/J3/J4/J5 and release acceptance remain held.

Parent verification: the four new no-network tests and existing live-entry
guards passed, **2 files / 44 tests** total. TypeScript, the full production
cloud/web/desktop build, bounded build-output audit and whitespace checks passed.
These are local synthetic/build checks; no database helper, real provider,
source export or native application was run. Independent correction review and
hosted checks are still required before merge.
