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

Never commit `.env`, source histories, device/pairing credentials, or provider keys. The public repository contains synthetic fixtures only. [Reuse and license record](docs/reuse-and-licenses.md).

## Local T3 thread MCP

The optional [NemoPal coding-thread MCP server](packages/mcp-bridge/README.md) exposes bounded `read_thread` and queued `send_message` tools for one owner-selected local T3 thread. Configure `NEMOPAL_T3_THREAD_ID` when launching the desktop and open **Local coding thread** to read/send without cloud pairing. External MCP hosts can run `pnpm mcp:thread` with the same selection; the linked guide includes a direct host launch configuration. The cloud manager does not automatically receive the transcript.
