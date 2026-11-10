# NemoPal compact board and task interaction revision

This implements the user's thirteen requested changes and subsequent refinements. It supersedes the previous review candidate; it does not grant visual, native or live-model acceptance.

## Composition

- The board is the sole center workspace. No Overview page, Project info, Updates, or separate Check-ins navigation.
- A compact project row contains its actual name, status and progress. Remove the global renderer toolbar; retain the native Windows title bar.
- Projects use manager avatars and real project information. Search and the New project icon share a row. Settings and Reset layout are labeled icon controls in the lower-left footer.
- Manager chat contains actual questions and replies. Completion sends the canonical `recorded` action; Not yet preserves task status. No More options, snooze or dismiss controls in chat. Pet presentation remains unchanged.
- Columns are approximately 216 CSS pixels, start aligned, and grow with their cards up to the available viewport. Large columns scroll internally. The board pans horizontally without making the document scroll.

## Interaction and task data

- Drag from the card surface or title, with movement threshold and click-to-open details. Inputs and status actions remain interactive. Preserve keyboard sorting, Escape rollback and external-update cancellation.
- Primary drag on unused canvas or column-list space pans; middle drag and wheel behavior supplement it. Captured-pointer cancellation and unmount must leave no handlers or global styles behind.
- Replace status selects with accessible icon menus: spinning ring for in-progress, red exclamation for blocked, check for done, empty circle for todo and dash for skipped. Respect reduced motion.
- Cards show actual deadline, description presence and checklist progress rather than repeating provenance paragraphs.
- A focus-trapped task dialog edits description, deadline and stable checklist items. Supporting evidence and source facts remain available there. No invented attachments, comments, members or metrics.
- Optional bounded metadata preserves legacy task DTOs. A strict `update_task_details` action checks project and task revisions. It preserves task status, evidence and owner override. Completing a checklist does not automatically complete its task.
- Persist unsaved metadata and the original pending command in the existing draft store. Uncertain saves retry the same operation and payload; stale responses cannot delete newer drafts or silently rebase dirty edits.

## Ownership and order

1. Board interaction worker owns TaskBoard, compact board CSS, the local pan hook and focused tests.
2. Shell/chat worker owns App and shell/chat presentation, header/sidebar changes and focused tests.
3. Metadata worker owns contracts, Store and fixture semantics, plus isolated contract/persistence tests.
4. Detail worker takes the released TaskBoard ownership and adds the dialog/card metadata. The coordinator owns its App save adapter, shared main-only Question presentation, test migration and joined verification.
5. Fresh independent code/security reviews cover completed slices. The coordinator fixes small findings and verifies the joined source before publishing focused changes.

## Verification and boundaries

Retain draft, editor identity, delayed acknowledgment, project-switch, owner authority and receipt checks. Run focused tests, then the applicable UI/contracts suite, typecheck, production build and bounded artifact audit. Verify real pointer card/title dragging, column movement, pan, keyboard menus, dialog editing and replay, resize/drawers at 1240×820, 1366×768, 1440×900, 2000×1050 and 800×600, plus text reflow. Use one initial visual batch and one correction batch unless a new defect or user feedback requires more.

The held root, credentials and accounting remain untouched. No database, provider, source export, phone, native GUI or deployment run is authorized here. Injected SQL is offline evidence only. Sample board placement is still local renderer state until canonical board persistence is separately implemented; metadata uses the real owner-action interface. Pet, Sendblue and T3 integration remain with their separate owners. PR40 stays draft until renewed user visual approval; no main/release merge.
