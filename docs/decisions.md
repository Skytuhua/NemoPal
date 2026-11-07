# Build decisions

The owner supplied and authorized execution of `living-playbooks-master-plan.md` on 2026-11-07. Its hybrid architecture and three lanes are the accepted baseline; this is implementation, not a new product design exercise.

- Standalone workspace: `C:\Users\user\Documents\NemoPlaybook`. The only original file was the master plan, preserved unchanged (SHA-256 `B754FDEED280311545F354496E3FA3BE407B7254A6A3DBD758F06778DD94E5F0`).
- The owner authorized a public GitHub repository: https://github.com/Skytuhua/NemoPlaybook . Every implementation/fix is submitted in a feature PR. No automatic merge is authorized by this plan.
- Root manifests, lockfile, shared schemas/client, fixtures, and integration belong to Lead. A owns cloud/Nemotron, B desktop/observer, C web/catalog/pet drawing. Builders use prepared separate checkouts from the frozen contract commit and must not change another lane's files.
- Node 24.14.0 and pnpm 10.30.3 are installed. Dependencies are exact-pinned in package.json and the lockfile. Native Electron behavior is a separate gate from TypeScript/unit checks.
- Nemotron account access is pending the owner's API application. No key, model endpoint, or call budget is configured. Do not make live model calls or substitute providers.
- The owner permitted choosing any harmless observation conversation. Select a project build-test conversation only; do not scan private histories. Cloud sharing remains off until a named receiving endpoint and disclosure choice can be shown.
- No cloud host/database has been selected. A disposable local PostgreSQL may support transaction tests; local persistence is not evidence of a cloud deployment.
- No Gen code will be copied for the baseline: standalone small components avoid another repository's dependency/license coupling.
- SMS, MCP, phone, installers, and other harness adapters stay deferred until required live gates pass.

## Contract rulings

1. `CheckIn.revision` is explicit because answer/snooze commands fence the question as well as its `subjectRevision` task. Cloud increments it on each logical transition; presentation does not increment project revision or create inference.
2. `PlaybooksClient` retains the master plan methods and adds the source/job/question commands required by its endpoint table. Desktop credentials stay in main; UI uses a typed command map through preload.
3. `ObservationBatch` is local, containing its cursor and coverage; `IngestObservationsInput` carries only normalized observations. Local paths/source cursors never enter cloud schemas.
4. Workspace panels are a flat ordered array. Each panel has one trusted type and entity references; this satisfies depth <=2 without recursive layout code.
5. Contract shape validation and snapshot reference checks do not replace cloud authorization, grant/epoch fencing, or semantic proposal validation.

## Sources checked during setup

- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Vitest configuration: https://vitest.dev/config/
- Zod strict schema API: https://zod.dev/api
- Dependency versions were queried from the official npm registry before pinning. Actual installed versions and command evidence are recorded in preflight.
