# Pairing destination recovery correction

Base: PR #7, `388bf7ff93b6042b735615b29523660699ec31fb`. This focused correction stacks on `t3/desktop-pairing-bootstrap`; other implementation lanes are not included.

The independent review reproduced one P2: a false, rejected, malformed or expired pair response restored the old destination's form without checking current capabilities. A subsequent code could therefore be submitted while the renderer displayed an obsolete destination. Workspace construction remained closed, and no real credential transmission was performed in the reproduction.

All uncertain pair outcomes now use the existing unavailable/Retry connection state. The code form stays removed until a fresh generation-fenced capability check supplies the current destination. If the first redemption succeeded but its response was lost, a canonical paired capability can open the workspace without redeeming a second code. No schema, native authority, dependency, storage or token changes.

Evidence on 2026-11-07:

- Five new regression cases failed on the baseline: destination changed after each of the four unsuccessful response classes, plus ambiguous redemption recovery.
- After the correction, all 40 pairing tests passed. Prior recovery and code-clearing tests now require capability recheck rather than immediate resubmission.
- Full available suite: 21 files / 136 tests passed. TypeScript, Vite production web build, evidence checker and diff checks passed.
- A separate code reviewer inspected the narrow correction and tests: no findings; static review only, no tests or external calls by that reviewer.

All interaction proof here uses synthetic jsdom bridges and storage spies. Real pairing, native preload, OS credential handling, cloud authorization, actual IndexedDB and visual acceptance remain separate gates. The evidence checker still reports 36 full acceptance cases with none marked passed from this partial proof.
