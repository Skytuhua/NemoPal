# Native project-navigation integration correction

Base: desktop PR #5, `69041e63baf25f413dc7b17e2ed7ad923dfe771c`. This correction is stacked on `t3/living-playbooks-observer`; cloud PR #6 and pairing PR #7 are not included.

The native pet's Open action previously revealed the workspace without selecting the pet's project. The visible Electron launcher also requested `windowsHide: true`; Lane B's controlled Windows investigation found the workspace remained invisible with that setting.

The correction adds the strict IPC v1.1 `open_project` event, wires B's supplied native producer patch, and selects only a project in the renderer's authorized list through the existing draft-flushing path. Invalid identities or extra authority fields are rejected. A failed storage flush retains the current project/editor. The application launcher now uses `windowsHide: false`. No dependency, HTTP DTO, database migration, or signature changes.

The supplied `tests/desktop/native-open-project.patch` is incorporated in this correction; do not apply it again after this layer is merged.

## Evidence

- Initial focused run: three expected failures (new event rejected, project not selected, flush failure not surfaced), three existing negative cases passed.
- Focused corrected run: six tests passed across `tests/contracts/ipc-open-project.test.ts` and `tests/ui/open-project.test.tsx`.
- Parent main-plus-correction run before joining B: 22 files / 102 tests passed, typecheck, Vite web build, evidence checker passed.
- Parent B-plus-correction run on 2026-11-07: `pnpm test`, 39 files / 134 tests passed; `pnpm typecheck`, web production build, evidence checker, and `git diff --check` passed.
- `pnpm test:native`: PASS on actual Windows, Electron 45.2.3. Controlled synthetic HTML exercised second-process lock denial, isolated sandbox preloads/no renderer Node or tokens, denied forbidden IPC, topmost pet shown without focus, tray Open/Hide/click-through callbacks, close-to-tray, work-area clamping, protected credential encryption/restart decryption, and stop/flush/Quit ordering.
- Independent code reviewer traced native project authority/current pet scope, strict renderer events, and draft preservation. No confirmed correctness, security, or data-loss regression; static review only, no tests rerun by reviewer.

## Limits

The native smoke does not exercise the complete C product renderer or actual pet-to-App navigation across processes. UI behavior is separately covered with synthetic jsdom and an in-memory draft adapter. Physical tray clicks, display removal, full animation/reduced-motion rendering, real IndexedDB races, cloud questions, live Codex observation, and live model integration remain unverified. The acceptance ledger still has no full cases marked passed from this partial proof.
