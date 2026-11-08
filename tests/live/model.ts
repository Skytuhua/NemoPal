import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, ModelCapabilityReportSchema } from '@living-playbooks/contracts';
import { HttpNemotronAdapter } from '@living-playbooks/nemotron';

export async function runModelGate(env: NodeJS.ProcessEnv, fetcher?: typeof fetch) {
  const evidence = {
    gate: 'model_capability_probe', status: 'BLOCKED' as 'BLOCKED' | 'PASS',
    blocker: 'operator_opt_in' as string | null,
    execution: 'not_run' as 'not_run' | 'synthetic' | 'live',
    probeAttempted: false, probePassed: false, fullAppVerified: false,
    toolSelection: false, toolResultInterpreted: false,
    strictProposalSchema: false, proposalAuthorityValidated: false,
    modelCallLimit: LIMITS.modelCalls as number, tokenAllowance: 0,
    modelCalls: 0, reservedTokens: 0, deadlineMs: LIMITS.jobDeadlineMs,
    endpointSha256: null as string | null, modelSha256: null as string | null,
  };
  if (env.LP_LIVE_TEST_OPT_IN !== '1' || env.LP_MODEL_LIVE_OPT_IN !== 'true')
    return { exitCode: 2, evidence };

  evidence.blocker = 'configuration';
  try {
    const callBudget = Number(env.LP_MODEL_CALL_BUDGET);
    const tokenBudget = Number(env.LP_MODEL_TOKEN_BUDGET);
    if (![callBudget, tokenBudget].every(value => Number.isSafeInteger(value) && value > 0))
      return { exitCode: 2, evidence };
    const adapter = new HttpNemotronAdapter({
      baseUrl: env.NEMOTRON_BASE_URL ?? '', model: env.NEMOTRON_MODEL ?? '',
      apiKey: env.NVIDIA_API_KEY ?? '', callBudget: Math.min(callBudget, LIMITS.modelCalls), tokenBudget,
    }, fetcher ?? fetch, async tokens => {
      evidence.modelCalls++;
      evidence.reservedTokens += tokens;
    });
    evidence.modelCallLimit = Math.min(callBudget, LIMITS.modelCalls);
    evidence.tokenAllowance = tokenBudget;
    evidence.blocker = 'probe_failed';
    evidence.execution = fetcher ? 'synthetic' : 'live';
    evidence.probeAttempted = true;
    const report = ModelCapabilityReportSchema.parse(await adapter.probe(AbortSignal.timeout(LIMITS.jobDeadlineMs)));
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    evidence.endpointSha256 = hash(report.endpoint);
    evidence.modelSha256 = hash(report.model);
    evidence.toolSelection = report.toolCall;
    evidence.toolResultInterpreted = report.toolContinuation;
    evidence.strictProposalSchema = report.structuredProposal;
    // The production probe validates proposal authority before setting structuredProposal.
    evidence.proposalAuthorityValidated = report.structuredProposal;
    evidence.probePassed = report.available && report.toolCall && report.toolContinuation && report.structuredProposal;
    if (evidence.probePassed) {
      evidence.status = fetcher ? 'BLOCKED' : 'PASS';
      evidence.blocker = fetcher ? 'synthetic_only' : null;
    }
  } catch {
    // Provider bodies, configuration values and exception messages never enter the receipt.
  }
  return { exitCode: evidence.status === 'PASS' ? 0 : 2, evidence };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runModelGate(process.env);
  console.log(JSON.stringify(result.evidence));
  process.exitCode = result.exitCode;
}
