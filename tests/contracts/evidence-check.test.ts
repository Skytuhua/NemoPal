import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function runLedger(change: (ledger: any) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'playbooks-evidence-'));
  try {
    const path = join(dir, 'acceptance.json');
    const ledger = JSON.parse(readFileSync('docs/evidence/acceptance.json', 'utf8'));
    for (const item of ledger.cases) Object.assign(item, { status: 'not_run', mode: 'none', commit: null, evidence: [], reason: 'Not run' });
    change(ledger);
    writeFileSync(path, JSON.stringify(ledger));
    return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', path], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true }); }
}
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

it('rejects passing acceptance without a receipt or immutable revision', () => {
  const run = runLedger(ledger => Object.assign(ledger.cases[0], { status: 'passed', mode: 'fixture' }));
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('Invalid acceptance ledger');
});

it('rejects fixture proof for the genuine Nemotron acceptance case', () => {
  const run = runLedger(ledger => Object.assign(ledger.cases[3], { status: 'passed', mode: 'fixture', commit: head(), evidence: ['living-playbooks-master-plan.md'] }));
  expect(run.status).toBe(1);
});

it('rejects evidence paths and revisions that cannot be resolved in this repository', () => {
  const missing = runLedger(ledger => Object.assign(ledger.cases[0], { status: 'passed', mode: 'fixture', commit: head(), evidence: ['docs/evidence/missing-receipt.json'] }));
  expect(missing.status).toBe(1);
  const invalidCommit = runLedger(ledger => Object.assign(ledger.cases[0], { status: 'passed', mode: 'fixture', commit: '0'.repeat(40), evidence: ['living-playbooks-master-plan.md'] }));
  expect(invalidCommit.status).toBe(1);
});

it('requires the complete known acceptance case inventory', () => {
  expect(runLedger(ledger => { ledger.cases[0].id = 'A99'; }).status).toBe(1);
  expect(runLedger(ledger => { ledger.cases.pop(); }).status).toBe(1);
  expect(runLedger(() => {}).status).toBe(0);
});
