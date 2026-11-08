# Living Playbooks

A standalone project companion: a Windows workspace, one bounded cloud Nemotron manager, consented observation of one selected Codex conversation, and an animated desktop pet for useful check-ins.

The [owner-supplied master plan](living-playbooks-master-plan.md) is the baseline. This repository is under active construction. **No live Nemotron integration, automatic observation, native pet behavior, or cloud deployment is accepted yet.** Fixtures are labeled and cannot silently replace a live dependency.

## Build lanes

- Lead: shared contracts/client, dependency pins, fixtures, integration and acceptance evidence.
- A: PostgreSQL/auth/API, bounded Nemotron tools/proposals, persisted check-ins.
- B: Electron main/preloads, selected read-only observer, consent, durable upload journal.
- C: three-pane React workspace, six trusted panels, drafts, pet rendering and original artwork.

All changes are submitted in focused PRs. Shared contracts freeze before builders branch. See [build ledger](docs/build-ledger.md), [contract v1](docs/contracts-v1.md), and [preflight](docs/evidence/preflight.md).

## Foundation checks

Node 24.14.0 and pnpm 10.30.3 are pinned. From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm test:contracts
pnpm typecheck
pnpm evidence:check
```

Application commands are listed in `package.json` and master-plan Section 19. Missing implementation or live credentials produces failure or `BLOCKED`, never a passing acceptance claim. The full app build becomes usable after the lane PRs join.

## Local Codex conversation demo

With the installed Codex CLI and a configured account, run `pnpm demo:codex "C:\absolute\path\to\workspace"`. Confirm the displayed workspace and permissions by typing `START`; type messages, `/history` to reread this session, and `/quit` to stop. Each launch creates a new app-server thread and uses that thread for every message. It does not attach to an existing T3 thread. The conversation display is local to this process; this demo is not connected to the desktop pet, cloud sync, or the existing observer.

The demo requests Codex's `read-only` sandbox and `never` approval policy, and stops on any server request instead of approving it. These settings do not limit all reads to the chosen workspace, nor necessarily constrain configured MCP servers or integrations. Review your Codex configuration and sandbox support before use. Messages use the configured provider/account and may incur usage; no model request is sent until you enter a message. This path targets the installed 0.167 app-server protocol and does not claim live or native acceptance.

Never commit `.env`, source histories, device/pairing credentials, or provider keys. The public repository contains synthetic fixtures only. [Reuse and license record](docs/reuse-and-licenses.md).
