# Codex local integration status

The local Codex demo is **not complete**. NemoPal cannot currently send a message to a Codex thread, subscribe to its live updates, or display or answer its approval requests. Its project chat sends to the playbook service, not Codex. Do not use it as a substitute for a Codex message.

The existing read-only observer is pinned to the installed Codex CLI protocol version 0.167.0. It validates the explicitly selected thread ID and workspace after local-read consent, enrolls at the current tail, and polls a bounded page of persisted completed turns. It does not import older history at enrollment, follow in-progress content, or handle approvals. The selected thread may have been created with an older CLI version. Existing 0.166.0 bindings are not migrated or silently reauthorized; they fail closed on the version mismatch. Re-enrollment requires the existing explicit consent flow.

The desktop source selection is still limited to an explicitly named synthetic source through `LP_SELECTED_SOURCE` and `LP_SYNTHETIC_SOURCE_NAME`, and source enrollment currently requires pairing. This is not a general thread picker. No live source has been read to validate this version update.

Run the synthetic observer checks from this checkout with Node 24.14 and pnpm 10.30.3:

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/desktop/observer-codex-version.test.ts tests/desktop/observer-readonly.test.ts tests/desktop/observer-cursor.test.ts tests/desktop/observer-privacy.test.ts tests/desktop/observer-terminal-turns.test.ts tests/desktop/j3-delivery-prepared.test.ts
pnpm typecheck
```

These checks use synthetic transport responses; they do not send messages, access a real thread, or prove native desktop operation. The offline install requires the dependencies to already be cached.

The installed 0.167.0 generated protocol and [Codex app-server documentation](https://developers.openai.com/codex/app-server/) describe `thread/resume`, `turn/start`, `turn/steer` (with an expected active turn ID), streamed notifications, and server-initiated approval requests. `thread/read` does not subscribe or load a thread. A newly spawned, independent app-server cannot be assumed to own or observe an active turn running in another harness. The next integration needs an authorized connection to the actual owning app-server, or a separately agreed exclusive ownership handoff for an idle thread, plus explicit send consent and honest handling of errors, active turns, pending approvals, and disconnects. Until that exists there is no safe end-to-end run command to provide.
