# Native enrollment and withdrawal correction

Base: PR16 / 9737a41b49d1e5e5f94390afa96477cd1b4ddb8d. Parent owns this follow-up after all original implementation/review work stopped.

Confirmed device-wide withdrawal now invalidates stale previews, refreshes persisted bindings after confirmation and fences earlier in-flight enrollments by device and operation. Late enrollment writes stopped state and the original-revision cloud cleanup command atomically in its first journal write. Known commits settle before success; later failures use the sanitized native warning path. Revocation dominates pause and cancellation preserves prior consent.

Custody is checked after snapshot loading and on the returned binding. More critically, the actual native HTTP transport rechecks operation, withdrawal, quitting, current device and Authorization immediately before fetch, after the real client's asynchronous hashing/authorization awaits. No public IPC/DTO or dependency changes. Pending-cloud status refreshes device bindings so completed late enrollments are included.

Meaningful RED: four confirmation/success enrollment races, two first-write/restart cases, three snapshot/returned-custody cases, two real-client hashing races, and one late pending-status case. Each failed the intended protection before its correction. Cancellation and late-write native-error checks also pass.

Verification: full47files231tests PASS; final typecheck PASS after typing the synthetic observer stop port; desktop85tests PASS; independent fresh focused35tests/typecheck/diff PASS with no findings. Desktop production main/preload bundle PASS. Tests execute actual main/client/vault/controller/journal/tray with synthetic OS/network/observer ports, including real command hashing and real temporary journal restart. No native process, actual source, provider, DB or deployment was used for this correction. Native A17 acceptance remains unverified; the separate scripted native-checkin startup incident is not claimed fixed here.

Original review rounds caught additional durability and custody gaps; those intermediate changes were never merged. No source access was resumed or new permission granted by a model. All real source export remains OFF.
