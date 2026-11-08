# Native observation transport authority

T11 F1 concerns an observation upload selected while consent is current, then
sent after local pause/revoke or a receiving/device identity change during the
API client's asynchronous hashing or authorization lookup.

The native transport now checks the exact durable queued operation and payload,
route binding, current device and Authorization header, following/grant/export
state, and acknowledged receiving endpoint/disclosure immediately before fetch.
There is no asynchronous preparation between that check and fetch. The journal
lookup is synchronous; pause/revoke's existing immediate in-memory fence remains
effective while a durable write is pending. Rejected sends are not acknowledged.
Pause retains queued observations; revoke retains its durable cloud cleanup
command while removing queued observations through the existing journal path.

## Executed regression evidence

The real native main entry point, journal, protected-credential implementation,
IPC boundary and final transport run with synthetic Electron/network ports. The
real HTTP client performs hashing and authorization lookup. No HTTP request
leaves the process: a recording fetch stub is the only destination.

Before the correction, **8 tests failed** because recording fetch received a
queued upload after pause, revoke, receiver change or re-pairing during either
asynchronous client step. Both unchanged-authority controls passed.

After the correction, **14 focused tests pass**: those eight race cases, two
unchanged controls, and four cases changing queued operation ID, payload,
binding route or Authorization header. Rejected queued work remains durable
except when explicit revocation removes it. The controls reach the recording
transport, so blanket rejection cannot satisfy the suite.

```powershell
pnpm exec vitest run tests/desktop/main-upload-authority.test.ts --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm exec esbuild apps/desktop/src/main/index.ts --bundle --platform=node --format=esm --external:electron --outfile=apps/desktop/dist/main/index.js
```

The final complete desktop run passed **156 tests in 26 files**. Type checking,
the desktop bundle and whitespace validation passed. Initial type checking
rejected possibly absent test fixtures; explicit presence guards correct those
types. Independent review found no actionable F1 issues, and independently
reran all **14 focused tests** plus whitespace validation. Its broader test,
type and bundle receipts remain attributed to the parent.

## Limits and remaining work

This is synthetic regression proof, not native Windows, real source, hosted
cloud, provider or full J3 acceptance. No secret was read and no database,
provider, source export or native GUI was started. Hosted checks remain a
separate publication gate. This fence cannot recall an upload already sent
before withdrawal.

T11 F3 (old-owner reads/presentation after re-pairing) remains a separate release
blocker. This change does not delete or transfer prior-device journal custody.
The rejected UI replacement and Railway deployment remain held separately.
