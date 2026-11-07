# Railway deployment handoff

Candidate configuration only. Do not deploy PR6's reviewed-but-unfixed cloud
head `d61bc552b81d1a0969fb8a2c3bef73ac1a2a85a0`. The coordinator must first
approve its cloud policy/lease corrections and this configuration independently.
This branch starts at `1f337fb8b5c1273dc7fe02d0612238e1a29b5c10` on
`feat/integration-preflight`; that base has no cloud implementation. Deploy an
integration branch containing these three files AND the reviewed PR6/cloud-fix
head, eventually `main` after those changes merge. This config branch alone is
not a deployable application. Do not point Railway at it or enable PR previews.

## Service settings (coordinator owns the dashboard)

- One always-running application service and persistent PostgreSQL; one replica.
- Disable GitHub autodeploy and PR previews while provisioning. Verify the
  configured repository and trigger branch; do not treat a staged change as
  effective until it is applied. Keep deployment paused until the coordinator
  approves the exact integrated source SHA.
- Review all pending changes in the canvas **Details** panel. Railway documents
  holding Alt while clicking **Deploy** to apply staged changes without a
  redeploy. Verify the resulting settings and deployment history; ordinary
  **Deploy** can start affected services. Networking changes apply immediately.
- Repository root directory `/`; leave Config File Path unset.
- Set service variable `RAILWAY_DOCKERFILE_PATH` to
  `/deployment/railway/Dockerfile`; leave Build/Start command overrides empty.
- Pre-deploy command `node --import tsx apps/cloud/src/db/migrate.ts`;
  Pre-deploy Timeout 120 seconds. Failed migration must block promotion.
- Healthcheck Path `/health/ready`; Healthcheck Timeout 120 seconds.
- Restart policy On Failure, maximum 3 retries; overlap 0 seconds;
  draining 150 seconds. Verify these in the deployment details.
- Keep serverless/sleep disabled. No cron, GPU, provider service or worker replica.
- Generate the HTTPS domain and set the required variables. After correction
  and review, deploy only the coordinator-approved integrated commit using
  Railway's `serviceInstanceDeployV2` API with explicit `commitSha`, service ID
  and environment ID. Check the returned deployment's actual commit SHA and
  settings against the approved SHA before acceptance. Do not use **Deploy
  Latest Commit**: a branch can advance between review and deployment. If a
  pinned deployment or identity verification is unavailable, keep the service
  staged and investigate instead of silently deploying a moving branch.

This image serves the cloud API only. PR6 does not serve the web build; the
desktop/UI deployment remains under its existing owners.

Dashboard settings are deliberate. [Railway IaC documentation](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code)
states new services cannot opt into legacy `railway.json`/`railway.toml` and
existing files stop being read on 2026-12-01. Do not set a Config File Path.
Supported TypeScript IaC is evaluated by `railway config plan/apply`; it would
add an SDK dependency and a project/environment resource definition. For this
single dashboard-owned service, the explicit settings above avoid that extra
scope. A passing legacy JSON schema check does not prove new-service support.

## Environment names and safe setup

| Name | Handling |
| --- | --- |
| `DATABASE_URL` | Server secret reference to the intended persistent Railway PostgreSQL service's private connection URL; never copy into source/build args. |
| `PUBLIC_ORIGIN` | Exact generated HTTPS origin, without trailing slash. Required: cloud derives `0.0.0.0` binding from a non-loopback origin; default is loopback only. |
| `PORT` | Railway injects it. Cloud listens on this port; do not hardcode a dashboard target port. |
| `RAILWAY_DOCKERFILE_PATH` | Select the nested Dockerfile as described above, independently of deprecated Config as Code. |
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

The first must be set as the explicit Railway pre-deploy step, never app startup.
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
Application shutdown handles SIGTERM/SIGINT; set 150 seconds before
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

Local Linux Docker checks used an ephemeral `git archive` context from PR6
`d61bc552`, with these deployment files overlaid. No other Git worktree was
created. This does not qualify the forthcoming corrected cloud SHA.

- Frozen install passed for the four selected workspaces; cloud bundle 844.3 KB.
- Runtime Node 24.14.0, UID 1000, SQL present; all three safe flags false; no
  `.env`, desktop/web source or downloaded Electron binary.
- Source migration passed twice against a new, isolated PostgreSQL 17 database.
- From another container, custom `PORT` and HTTPS `PUBLIC_ORIGIN`: readiness
  200, liveness 200, unauthenticated projects/SSE 401.
- Graceful SIGTERM exited 0; app restart restored readiness and 14 schema tables.
  Owners, jobs and model-usage rows stayed empty. No grant was issued.
- Additional database-stop injection exposed an application crash; coordinator
  must inspect the cloud-owned pool error/recovery behavior before deployment.

Local model-off checks are separate from hosted TLS/SSE, authorized persistence,
model/native/source acceptance. Independent review and corrected-cloud rerun
remain required. No hosted cloud-app deployment, provider call, source export or owner
grant performed. Only test-owned containers/network were removed.

Provider references: [Dockerfile path](https://docs.railway.com/builds/dockerfiles#custom-dockerfile-path),
[staged changes](https://docs.railway.com/deployments/staged-changes),
[GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys),
[commit-pinned deployment](https://docs.railway.com/integrations/api/manage-services),
[pre-deploy](https://docs.railway.com/deployments/pre-deploy-command),
[healthchecks](https://docs.railway.com/deployments/healthchecks),
[SSE](https://railway.com/guides/streaming-ai-responses).
