import type * as c from '@living-playbooks/contracts';
import { BoundedRunner, HttpNemotronAdapter, ProviderError } from '@living-playbooks/nemotron';
import { JobQueue } from './queue';
const safeCodes = new Set(['provider_auth', 'provider_rate_limit', 'provider_network', 'provider_unavailable', 'unsupported_schema', 'unsupported_pending', 'unsupported_response', 'provider_redirect', 'input_budget', 'output_budget', 'tool_output_budget', 'model_budget', 'tool_budget', 'account_budget', 'model_contract', 'tool_contract', 'tool_scope', 'tool_identity', 'proposal_contract', 'proposal_scope', 'proposal_grants', 'proposal_evidence', 'proposal_evidence_level', 'proposal_owner_authority', 'proposal_owner_override', 'proposal_completion_authority', 'proposal_component_references', 'proposal_task_revision', 'proposal_task_identity', 'proposal_duplicate_task', 'proposal_question_subject', 'proposal_stale', 'job_aborted', 'lease_lost', 'lease_project_paused', 'model_configuration']);
export async function runJob(queue: JobQueue, adapter: c.NemotronAdapter, job: c.ManagerJob, external: AbortSignal) {
    const controller = new AbortController();
    const signal = AbortSignal.any([external, controller.signal, AbortSignal.timeout(120000)]);
    let lastRenew = Date.now();
    let checking = false;
    const monitor = setInterval(() => {
        if (checking)
            return;
        checking = true;
        void queue.context(job).then(async () => { if (Date.now() - lastRenew >= 30000) {
            await queue.renew(job);
            lastRenew = Date.now();
        } }).catch(() => controller.abort()).finally(() => { checking = false; });
    }, 1000);
    try {
        const context = await queue.context(job);
        const scoped = adapter instanceof HttpNemotronAdapter ? adapter.withAuthority(() => queue.context(job)) : adapter;
        const runner = new BoundedRunner(scoped, { beforeCall: async () => { await queue.context(job); await queue.countCall(job); }, beforeTool: () => queue.context(job), toolCount: () => queue.countTool(job), toolReceipt: receipt => queue.receipt(job, receipt),beforeRepair:()=>queue.claimRepair(job) });
        const proposal = await runner.run(job, context, signal);
        await queue.commit(job, proposal);
    }
    catch (error) {
        let code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'model_error';
        if (signal.aborted) {
            try {
                await queue.context(job);
                code = 'job_aborted';
            }
            catch {
                code = 'proposal_stale';
            }
        }
        await queue.fail(job, code, error instanceof ProviderError ? error.retryAfterSeconds : 60).catch(() => { });
    }
    finally {
        clearInterval(monitor);
    }
}
export function startManagerDispatcher(queue: JobQueue, adapter: c.NemotronAdapter | null) {
    const controller = new AbortController();
    let active: Promise<void> | null = null;
    const tick = () => {
        if (!adapter || active || controller.signal.aborted) return;
        const running = Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            const job = await queue.claim();
            if (job && !controller.signal.aborted) await runJob(queue, adapter, job, controller.signal);
        });
        active = running;
        void running.catch(() => {}).finally(() => { if (active === running) active = null; });
    };
    const timer = setInterval(tick, 15000);
    tick();
    return async () => { clearInterval(timer); controller.abort(); await active?.catch(() => {}); };
}
