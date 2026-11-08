# Local NemoPal demo: integration status

This checkout contains the desktop Codex demo, Sendblue transport, and pet drag/chat code. It is **not yet a single Codex-and-texting demo**. The workspace Codex demo starts a separate in-memory local thread; pet chat and Sendblue use the cloud manager and its Nemotron adapter. No code connects Sendblue messages or pet chat to that Codex thread. Sendblue link enrollment is an authenticated API, not a desktop setup screen.

## Prepare offline

With Node 24.14.x and pnpm 10.30.3, from this checkout run `pnpm install --offline --frozen-lockfile --ignore-scripts`, then `pnpm typecheck` and `pnpm build`. These do not start the app. The build may report a large web bundle warning.

## Before any live demo

1. Resolve the previously rejected local-backend startup through its owning authorization process. Do not retry it or expose the laptop to obtain a webhook. An approved, owned API/database and normal desktop pairing are prerequisites; [setup.md](setup.md) describes the existing setup but is not permission to start it.
2. Complete and verify a bounded Codex manager integration if Codex is intended to answer pet and text messages. The existing [Codex demo](codex-local-demo.md) is a separate conversation; its local folder disclosure and provider usage still apply. No T3 connection is included.
3. For texting, separately configure the Sendblue environment, authenticated project/sender link, and an approved HTTPS webhook receiver as described in [Sendblue integration](evidence/sendblue-integration.md). Keep values private. The current manager path also requires its configured model capability; a direct Sendblue delivery alone does not establish inbound-to-manager-to-reply behavior.
4. After the applicable gates and explicit live-test authorization, verify desktop pairing, pet chat, Codex, and a two-way text using a known authorized contact. Check actual delivery and retain only redacted results. Do not send another text as part of offline preparation.

This is a handoff for the remaining work, not a claim of native, live, or user acceptance.
