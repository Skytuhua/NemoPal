# Railway deployment handoff

Candidate configuration only. Do not deploy PR6's reviewed-but-unfixed cloud
head `d61bc552b81d1a0969fb8a2c3bef73ac1a2a85a0`. The coordinator must first
approve its cloud policy/lease corrections and this configuration independently.
This branch starts at `1f337fb8b5c1273dc7fe02d0612238e1a29b5c10` on
`feat/integration-preflight`; that base has no cloud implementation. Deploy an
integration branch containing these four files AND the reviewed PR6/cloud-fix
head, eventually `main` after those changes merge. This config branch alone is
not a deployable application. Do not point Railway at it or enable PR previews.

## Service settings (coordinator owns the dashboard)

- One always-running application service and persistent PostgreSQL; one replica.
- Repository root directory `/`; Config File Path
  `/deployment/railway/railway.json`. Do not set root to `apps/cloud`.
- Dockerfile is selected by config; leave dashboard Build/Start overrides empty.
- Config caps pre-deploy at 120 seconds. Failed migration must block promotion.
- Keep serverless/sleep disabled. No cron, GPU, provider service or worker replica.
- Generate the HTTPS domain, set the required variables, then deploy only the
  coordinator-approved integration SHA. No service has been provisioned here.

## Environment names and safe setup

| Name | Handling |
| --- | --- |
| `DATABASE_URL` | Server secret reference to the intended persistent Railway PostgreSQL service's private connection URL; never copy into source/build args. |
| `PUBLIC_ORIGIN` | Exact generated HTTPS origin, without trailing slash. Required: cloud derives `0.0.0.0` binding from a non-loopback origin; default is loopback only. |
| `PORT` | Railway injects it. Cloud listens on this port; do not hardcode a dashboard target port. |
| `LP_MODEL_LIVE_OPT_IN` | Explicitly false. No startup model probe or manager claims with this disabled. |
| `LP_DEMO_TIMING` | Explicitly false. |
| `LP_REMINDERS_CONSENT` | Explicitly false until owner opt-in. This only affects later owner bootstrap; it does not revoke existing database consent. |

Keep `NVIDIA_API_KEY`, `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL`,
`LP_MODEL_CALL_BUDGET`, and `LP_MODEL_TOKEN_BUDGET` unset. No model/GPU request,
grant issuance, consent change, or local-source export is part of preparation.
Leave `LP_OWNER_TIMEZONE` and `LP_OWNER_ID` unset during preparation.
Later authorized bootstrap needs the confirmed `LP_OWNER_TIMEZONE`
(`America/Chicago` for this owner) and optional `LP_OWNER_ID` for an existing
owner. Never automate bootstrap on startup: its output is a one-use credential.
Desktop `LP_CLOUD_ORIGIN` belongs to desktop configuration, not this service.

## Exact commands

From the repository root with cloud code integrated:

```sh
docker build -f deployment/railway/Dockerfile -t nemoplaybook-cloud .
```

The Docker build pins Node 24.14.0/pnpm 10.30.3, runs
`pnpm install --frozen-lockfile --ignore-scripts` with
`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, then builds only:

```sh
pnpm exec esbuild apps/cloud/src/main.ts --bundle --platform=node --format=esm --target=node24 --external:fastify --external:pg --outfile=apps/cloud/dist/main.js
```

It installs the root tool dependencies because esbuild/tsx are root dev
dependencies. Lifecycle scripts are disabled, so Electron is not downloaded.
Only cloud/contracts/Nemotron source enters the allowlisted build context; no
desktop/UI source, `.env`, local data or Git history. Dev tools remain in the
runtime image to support existing source CLIs without changing dependencies.

Image commands (Node is PID 1 via Docker CMD):

```sh
node --import tsx apps/cloud/src/db/migrate.ts
node apps/cloud/dist/main.js
```

The first is the explicit Railway pre-deploy step, never part of app startup.
Unbundled migration retains `apps/cloud/src/db/schema.sql` beside `migrate.ts`;
its advisory lock serializes migrations. Source equivalents are `pnpm db:migrate`
and `pnpm dev:cloud`. Later operator-only bootstrap, when explicitly authorized:
`node --import tsx apps/cloud/src/auth/grant.ts` (source: `pnpm owner:grant`).
Run it only in a private operator session, never build/start/pre-deploy logs.

## Readiness, streaming and restart acceptance

`/health/live` checks HTTP liveness; `/health/ready` executes `SELECT 1`.
Readiness does not prove schema presence, auth, model availability, dispatcher
health or continuous monitoring. The explicit migration must succeed first.
Model-off projects report inference unavailable; queued jobs stay unclaimed.
The durable check-in dispatcher still runs for existing database enrollments.

SSE is authenticated `/v1/events?after=<cursor>` with one-second comment
heartbeats and `X-Accel-Buffering: no`. Keep proxies/compression from buffering;
clients must reconnect/refetch snapshots after disconnect or expired cursors.
Railway imposes a 15-minute request ceiling, so reconnect is still required.
Application shutdown handles SIGTERM/SIGINT; config allows 150 seconds before
SIGKILL, with three crash retries. One replica still has deployment overlap:
correct lease fencing is a prerequisite, never replaced by this configuration.

Before hosted acceptance, retain the exact deployed SHA and confirm HTTPS
readiness, unauthorized `/v1/projects` rejection, then an authorized synthetic
owner/project and prompt SSE invalidation delivery. Restart the service and
confirm the same project and accepted state survive, with inference unavailable
and no new model requests/duplicate jobs. Do not use private histories. Provision
pairing only after separate authorization. Hosted model/native/source acceptance
remains separate from this model-off hosting gate.

## Evidence

Pending local container build/runtime checks and independent parent review.
No hosted deployment, provider call, source export or owner grant performed.

Provider references: [configuration](https://docs.railway.com/config-as-code/reference),
[pre-deploy](https://docs.railway.com/deployments/pre-deploy-command),
[healthchecks](https://docs.railway.com/deployments/healthchecks),
[SSE](https://railway.com/guides/streaming-ai-responses).
