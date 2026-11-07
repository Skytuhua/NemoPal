# Preflight — 2026-11-07

Scope: the owner's supplied master plan, one new standalone Windows application, one cloud service and PostgreSQL. Competition start/deadline have not been supplied; 24 hours is a planning budget, not a measured remaining-time claim.

| Gate | Evidence / state |
|---|---|
| Original workspace | Only master plan; no Git repository, application, or user code before setup |
| Repository | Owner explicitly requested public repo; baseline plan committed on main |
| Toolchain | `node --version`: v24.14.0; `pnpm --version`: 10.30.3; `codex --version`: codex-cli 0.166.0; native `electron --version`: v45.2.3 after removing inherited `ELECTRON_RUN_AS_NODE` from the probe process |
| Nemotron | BLOCKED: owner is still applying for API access; endpoint/model/key/budget unknown |
| Observer | BLOCKED for live acceptance: harmless source selection delegated, exact protocol/schema and two real deltas not yet tested; export off |
| PostgreSQL | Docker Engine 29.8.0 now running; dedicated `living-playbooks-test-postgres` on loopback port 55432 accepts connections. Random credential is only in ignored `.env`; unrelated existing containers untouched. Product transaction tests wait for A |
| Cloud deployment | BLOCKED: authorized host/database not selected |
| Native pet/tray | NOT RUN: no implementation yet |

Fixtures and deterministic checks can proceed independently. A blocked live gate is never a passing skip or simulated success.

Foundation verification: pinned install with `--frozen-lockfile`, complete current `pnpm test` (contracts/client/script gates only), `pnpm typecheck`, and `pnpm evidence:check`. No cloud app, renderer app, observer, or overlay is implemented by this foundation. Its check count is not a product acceptance count; all 36 product cases remain `not_run`.
