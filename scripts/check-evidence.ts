import { readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';

const CaseSchema = z.strictObject({ id: z.string().regex(/^A\d{2}$/), scenario: z.string().min(1), status: z.enum(['not_run', 'passed', 'failed', 'blocked', 'deferred']), mode: z.enum(['none', 'static', 'fixture', 'integration', 'native', 'live']), commit: z.string().regex(/^[a-f0-9]{40}$/).nullable(), evidence: z.array(z.string().min(1)), reason: z.string() }).superRefine((value, ctx) => {
  if (value.status === 'passed' && (!value.commit || value.evidence.length === 0 || value.mode === 'none')) ctx.addIssue({ code: 'custom', message: 'A pass needs an immutable commit and evidence in a stated mode.' });
  if ((value.status === 'blocked' || value.status === 'deferred') && !value.reason.trim()) ctx.addIssue({ code: 'custom', message: 'A blocked or deferred case needs its reason.' });
});
const LedgerSchema = z.strictObject({ schemaVersion: z.literal(1), cases: z.array(CaseSchema).min(1) }).refine(value => new Set(value.cases.map(item => item.id)).size === value.cases.length, 'Duplicate acceptance case');
const requiredModes: Record<string, string[]> = {
  A04: ['live'], A09: ['live'], A10: ['live'], A23: ['integration', 'live'],
  A27: ['native', 'live'], A28: ['native', 'live'], A33: ['live'],
  A35: ['integration', 'live'], A36: ['live'],
};
try {
  const ledger = LedgerSchema.parse(JSON.parse(readFileSync(process.argv[2] ?? 'docs/evidence/acceptance.json', 'utf8')));
  const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  const master = readFileSync(resolve(root, 'living-playbooks-master-plan.md'), 'utf8');
  const known = new Map([...master.matchAll(/^\| (A\d{2}) \| ([^|]+) \|/gm)].map(match => [match[1]!, match[2]!.trim()]));
  if (ledger.cases.length !== known.size || ledger.cases.some(item => known.get(item.id) !== item.scenario)) throw new Error('Acceptance inventory mismatch');
  for (const item of ledger.cases) {
    if (item.status !== 'passed') continue;
    if (requiredModes[item.id] && !requiredModes[item.id]!.includes(item.mode)) throw new Error('Insufficient proof mode');
    if (execFileSync('git', ['cat-file', '-t', item.commit!], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== 'commit') throw new Error('Unknown commit');
    for (const evidence of item.evidence) {
      if (isAbsolute(evidence) || evidence.includes(':') || evidence.includes('\\')) throw new Error('Evidence must be repository-relative');
      const path = realpathSync(resolve(root, evidence));
      const local = relative(root, path);
      if (isAbsolute(local) || local === '..' || local.startsWith(`..` + '/') || local.startsWith(`..` + '\\') || local.startsWith('.git') || !statSync(path).isFile()) throw new Error('Evidence outside repository');
      execFileSync('git', ['cat-file', '-e', `${item.commit}:${local.replaceAll('\\', '/')}`], { cwd: root, stdio: 'ignore' });
    }
  }
  console.log(`Acceptance ledger valid: ${ledger.cases.length} cases, ${ledger.cases.filter(item => item.status === 'passed').length} marked passed with resolvable references. This checker does not execute or independently verify acceptance.`);
} catch {
  console.error('Invalid acceptance ledger: use unique cases, honest statuses, and immutable evidence for every pass.');
  process.exitCode = 1;
}
