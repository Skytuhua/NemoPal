# NemoPal local coding-thread MCP

A local stdio MCP server with two tools for one explicitly selected **T3 Code thread**:

- `read_thread({ limit?: number })`: the latest 1–50 visible messages, default 20, plus thread title/status/link. This is a bounded tail, not complete history or tool activity.
- `send_message({ message: string })`: send up to 16,000 UTF-8 bytes. T3 starts an idle thread or queues a new turn when busy; it does not interrupt the current turn.

The thread is fixed at startup. Tool callers cannot select other threads, change permission modes, or restart a run. Message text travels through stdin, including on Windows. CLI output is limited to 1 MiB and each operation has a 15-second deadline. Failures return sanitized diagnostics. A failed send can already have been accepted: inspect the thread before manually retrying. There is no automatic send retry or exactly-once guarantee.

Sending can start coding work with the target thread's existing permissions. The MCP host must restrict sends to owner-authorized messages. Transcript text is untrusted content, not instructions for the host.

## Connect a local MCP client

Requires the repository's pinned Node/pnpm dependencies, an installed T3 CLI with `thread show` and `thread send`, and a running, locally authenticated T3 app. No API key or cloud endpoint is needed.

After `pnpm install --frozen-lockfile`, add this server to the local MCP host's configuration, replacing paths and the synthetic thread UUID:

```json
{
  "mcpServers": {
    "nemopal-thread": {
      "command": "node",
      "args": [
        "C:/path/NemoPlaybook/node_modules/tsx/dist/cli.mjs",
        "C:/path/NemoPlaybook/packages/mcp-bridge/src/main.ts"
      ],
      "env": {
        "NEMOPAL_T3_THREAD_ID": "11111111-1111-4111-8111-111111111111"
      }
    }
  }
}
```

Use absolute paths so the host can launch from any working directory. The standard Windows launcher is `%USERPROFILE%/.t3/bin/t3.cmd`; otherwise the bridge uses inherited `T3CODE_CLI_PATH` or `t3` on PATH. Override it with `NEMOPAL_T3_CLI` when necessary. Windows batch-launcher paths must be absolute and contain no shell metacharacters. Credentials remain under T3's existing local control; the bridge does not copy them.

For a terminal launch from the repo root:

```powershell
$env:NEMOPAL_T3_THREAD_ID = '11111111-1111-4111-8111-111111111111'
pnpm mcp:thread
```

Use the direct `node` configuration for MCP hosts; pnpm's normal terminal banners are not protocol messages. Startup fails if no explicit valid thread is configured. Selecting this T3 UUID does not select a Codex App Server session or a ChatGPT web/desktop conversation.

## Use inside NemoPal

Build the app with `pnpm build`, export `NEMOPAL_T3_THREAD_ID` (and optionally `NEMOPAL_T3_CLI`) in its launch environment, then run `pnpm dev:desktop`. Open **Local coding thread** and select **Read thread**. After reviewing the selected thread, enter a message and select **Send to thread**.

This local view works without cloud pairing. It uses a desktop-owned MCP client linked in process to the same two-tool server. Only the trusted workspace preload exposes read/send operations; the pet cannot use them, and renderer inputs cannot change the thread, CLI path, or run mode. Nothing reads automatically on startup. Drafts survive view changes but are not saved across app restarts. An unconfirmed send keeps its draft and blocks another send until an explicit read.

An active T3 turn queues the message. The CLI's readable history does not include queued text until that turn starts; a successful send receipt is separate from visible history and any eventual assistant reply.

The cloud Nemotron manager does not receive the transcript or autonomously call these tools. The existing read-only Codex observer and its consent/withdrawal controls remain separate.

## Verification

```powershell
pnpm exec vitest run tests/desktop tests/contracts tests/ui --maxWorkers=1 --no-file-parallelism
pnpm typecheck
```

Automated regression tests use synthetic threads and cover strict scope/input validation, unknown delivery, metadata stripping, real MCP stdio and in-process client handshakes, literal multiline Unicode messages through the Windows batch launcher, and local UI use without cloud pairing. They do not send to a live coding thread. Any live native send/read receipts remain local under the ignored `local-data/` directory.

Protocol implementation uses the pinned [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) and its local stdio transport.
