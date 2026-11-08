# Bounded source-build output receipt

Scope: T14 source-preview preparation only, based on PR15
`f1718a9f1698a32181b594f83b82360f59645f16` /
`feat/golden-workflow-integration`. The only authored paths are new
`docs/setup.md`, `docs/demo.md`, `scripts/audit-build-output.ts`,
`tests/build-output-audit.test.ts` and this receipt. No production, root scripts,
package/dependency, contract, acceptance JSON, ledger or deployment edits.

## Execution and RED/GREEN

Local Windows checkout, Node `24.14.0`, pnpm `10.30.3`, 2026-11-08 UTC.
The clean starting HEAD was the exact base above. No children were started.

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx --test tests/build-output-audit.test.ts
pnpm typecheck
pnpm build
pnpm exec tsx scripts/audit-build-output.ts
git diff --check
```

- Frozen install passed, reusing the pinned packages with no manifest/lock edit.
- Initial meaningful RED: the one missing-output fixture asserted that an empty
  output tree must block. The importable scaffold returned a passing empty
  manifest, so the test failed **Missing expected exception**, exit 1. This was
  an assertion failure, not a missing-tool/module failure. Adding missing-output
  rejection made that first fixture GREEN, exit 0.
- Expanded fixture RED: 43 tests, 32 failed / 11 passed against the reject-only
  implementation. Valid manifests, forbidden inventory, credential formats,
  asset references, bounds and links were not yet implemented. After adding the
  audit, one malformed AWS-format test vector was corrected from 17 to the
  format's 16 suffix characters; no detector exemption was introduced.
- Additional self-review RED: two targeted assertions failed because the receipt
  did not explicitly report `secretAbsenceProven: false`, and a synthetic
  credential-shaped asset filename was accepted. The receipt now states that
  limit, and name-pattern rejection prevents disclosing such a name in a manifest.
- Final focused GREEN: **47 tests passed**, zero failed/skipped, exit 0. Includes
  known `hello` SHA-256, sorted exact inventory/counts/bytes, root-independent
  deterministic manifests, changed-byte digest, every missing intended entry,
  inventory-before-content rejection, source-map credential formats, local-only
  asset references, sibling exclusion, empty/oversize/aggregate/count limits,
  hard links, Windows junctions at output/ancestor/interior/anchor positions,
  invalid UTF-8, relative-anchor refusal, CLI path-option refusal and credential
  formats in generated asset names.
- TypeScript and `pnpm build` passed, exit 0. The actual root build ran Vite for
  web, then esbuild for cloud and desktop main/preloads. No server/app was started.
- Own-build audit passed, exit 0: **10 files, 5,401,007 bytes**. Diff whitespace
  check passed. The existing Vitest config does not discover this top-level Node
  test; its explicit command above is required.

No DB/full-suite, native/Electron, provider/model, source/Codex, browser, live
endpoint, cloud runtime, deployment or recording run was performed. No real
credential files or application profile were opened. Existing native/model
receipts are attributed separately in [demo.md](../demo.md), not reused as proof
of this build's runtime behavior. Parent independent review remains pending.

## Exact local output manifest

Manifest SHA-256:
`bc3caa2518ddf0bad5e12cd058ea31f4a81dcb89757eb1b5c24d4818526c25a7`.
Canonical input is UTF-8 `JSON.stringify(files) + '\n'`, where `files` is sorted
by relative path using code-point comparison; each object has fields in order
`path`, `bytes`, `sha256`. Hashes below cover exact file bytes, including maps.

| Fixed output root | Files | Bytes |
| --- | ---: | ---: |
| `apps/cloud/dist` | 2 | 2,488,056 |
| `apps/web/dist` | 4 | 387,265 |
| `apps/desktop/dist` | 4 | 2,525,686 |
| Total | 10 | 5,401,007 |

| Relative path | Bytes | SHA-256 |
| --- | ---: | --- |
| `apps/cloud/dist/main.js` | 869369 | `a1519bf797cb5c3c9797f8108095e2b2d0bed90e14754ec32de22cf7d8d201aa` |
| `apps/cloud/dist/main.js.map` | 1618687 | `fc3cc619dda11c2e1ba8dc9d5845a637b7f194363027ce3a6f680f11e8e6ff0e` |
| `apps/desktop/dist/main/index.js` | 886534 | `c1f210d8e165fbd1144ae44175fc27dd168bdf7d7ed36a33324d4e0ad105b9d8` |
| `apps/desktop/dist/main/index.js.map` | 1637676 | `2e815898cd560849e62f14d84f63e5bf00ffa3eff5b6dc885e097482ddd33cf9` |
| `apps/desktop/dist/preload/pet.cjs` | 519 | `abf71d1f608a5ee94f49afb5659cd877841eb5f467575be7b4529406775d2693` |
| `apps/desktop/dist/preload/workspace.cjs` | 957 | `8aa6e82b2c3186e40a203725ce21c4523425268a9dd12a1ddfa81de8a10f8fd1` |
| `apps/web/dist/assets/favicon-DICh16l8.svg` | 234 | `7eeabcf97e0e4d6ca8e0873c4f300842225915c644e050dff173019d47d8b1df` |
| `apps/web/dist/assets/index-BlKlPGqn.js` | 378946 | `65696fc7b87614d4d304a89cc9fec9a13a703523e1709b4b752c833aaafa7f2e` |
| `apps/web/dist/assets/index-Cz5R18ED.css` | 7433 | `630e20f090f0a1d6211e4e59071da816db883290d4b2f22305ca2c6f2ba94ae0` |
| `apps/web/dist/index.html` | 652 | `619a0b2909cd3a17bb68fc0897c2567af9a2548c9320b364a3ef5a0804cc91dc` |

These are this checkout's newly built bytes, not an assertion that an older
parent native run used the same artifacts. Rebuilds/source-map paths or toolchain
changes can change hashes. Re-run the audit after the parent's exact integration
build; retain its new receipt rather than copying this manifest forward.

Audit source SHA-256:
`ff0bf617585860cdf62b3bbcb0eac4cba2593170e433a1d78149f6f94c1bee25`.
Fixture test source SHA-256:
`02060924e895c312440b187cdc1df3805677f4242eb9aa5d0f25de8bdb7ad7be`.

## Audit boundaries and limitations

- The CLI anchors to this script's repository, accepts no path/options and visits
  only the three fixed output trees. It does not enumerate repository siblings,
  dependencies, environment files, journals, histories or the Windows profile.
  The exported anchor parameter exists for disposable synthetic fixture roots.
- Allowed files are the seven fixed cloud/desktop/web entries and flat generated
  web `assets/*.{js,css,svg}`. The HTML must reference present local `./assets/`
  JS/CSS (and any referenced icon). Unexpected files/directories fail closed.
  This is an inventory/presence check, not a JavaScript/HTML correctness proof.
- Before any file content read, inventory checks names, regular-file types,
  required entries, bounds and containment. Every path component is checked
  with `lstat`; symbolic links/junctions, hard-linked files and redirected anchors
  are rejected. No link target is traversed. Fixed allowed directory depth bounds
  recursion. Maximums: **512 files**, **1,024 directory entries** in aggregate,
  **16 MiB per file**, **64 MiB total**. Bounds reject; they never silently truncate.
- Forbidden-name checks include environment, credential/token/secret/pairing,
  device, journal, history/session/log names and common private-key/database
  extensions. The allowlist also excludes other unrecognized file formats.
  All UTF-8 output text, including source-map embedded source, is checked for
  obvious provider/GitHub/AWS key formats, JWTs, private-key headers, credentialed
  connection URLs, long bearer values and literal credential assignments. Two
  passes also inspect common JSON quote/slash/unicode escaping. Diagnostics are
  fixed categories; no matched text, source lines or absolute paths are emitted.
- Use a finished, **quiescent** own build. Rechecked paths, descriptor metadata,
  no-follow/nonblocking flags where available, fixed-size reads and post-read
  metadata checks catch ordinary changes. Portable Node path APIs are not a
  sandbox against a hostile concurrent writer swapping directory ancestors;
  Windows does not supply every POSIX no-follow flag. Do not mutate or audit an
  untrusted changing tree while relying on this receipt.
- **A pattern and inventory scan is not proof that no possible secret exists.**
  Arbitrary strings, encodings/encryption, split values, unfamiliar formats and
  private source without recognizable patterns can evade it. False positives
  can block an otherwise safe build. Do not weaken checks to publish questionable
  output. Maps intentionally contain source text and require review for sharing.
- The manifest identifies bytes; it is not a signature, reproducible-build proof,
  malware/dependency scan, packaged-distribution audit or release acceptance.
  Nothing in this receipt clears J2–J5, final demonstration, hosted deployment
  or native/user visual gates. Packaging remains deferred; use the documented
  source preview fallback. Acceptance JSON and build ledger are unchanged.

Parent owns receipt acknowledgment, later review/integration and direct-child
cleanup: confirm `status: completed`, `workState: result_available` and
`hasPendingChildRuns: false` via `task_status`, then recoverably archive the
returned child thread. This implementation does not watch, merge or self-archive.

## Parent correction after independent review

The baseline receipt above describes original PR27
`03cf2c5dcffdbce44cd97d420b0c23e19a6fc586`. Independent review found that
`readdirSync` materialized all entries before enforcing the advertised bound,
and common JSON-escaped Unicode credential strings escaped the scan. The parent
added failing enumeration and Unicode/source-map fixtures before correcting them.
Directory handles now enforce the aggregate limit as each entry is read and are
closed on every exit; only the bounded names are sorted. Credential inspection
checks original text and Unicode views after each of two bounded JSON slash/
quote unescape passes. Arbitrary encodings remain outside the claimed coverage.

The approved PR29 mouse is an explicit composition exception, not general image
support. Only `assets/pixel-mouse-idle-v1-<generated>.png` with exactly **960766
bytes** and SHA-256
`215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`
can bypass UTF-8 decoding. All inventory/link/size checks still apply; its raw
bytes and digest enter the manifest. Different names, changed or appended bytes
fail closed. The positive fixture reads the pinned public Git blob from PR29
commit `811cd5a63b985b74cbdd0897895fa823d3aeda5d`, avoiding a duplicate binary.
Full-history CI checkout retains that fixture. No private file is used.

Parent local verification: **55 Node fixtures PASS**, typecheck, production build,
baseline own-output audit and diff checks PASS. Four new regression assertions
failed against the old audit: unbounded enumeration, one/two JSON escape layers
and approved PNG admission. A first pnpm-filter invocation failed in the Windows
command shim before tests ran; the direct Node runner then supplied the actual
RED/GREEN evidence. The workflow now explicitly runs the Node fixtures and audits
the completed build. Existing baseline output hashes above remain historical;
the parent joined build with the mouse still requires its own new manifest after
review/integration. No root checkout/J2 resource, DB, native GUI, source, model,
provider or secret was accessed by these correction checks. Fresh independent
correction review remains required before merge.
