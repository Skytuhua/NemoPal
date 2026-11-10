import type { Pool } from 'pg';
import { HttpNemotronAdapter, type NemotronSettings } from '@living-playbooks/nemotron';
import { digest } from '../auth/credentials';
import { transaction } from '../db/transaction';
export async function reserveUsage(pool: Pool, settings: NemotronSettings, tokens: number, retainedCalls = 0) {
    const configuration = digest(JSON.stringify({ baseUrl: settings.baseUrl, model: settings.model }));
    return transaction(pool, async (db) => {
        await db.query('INSERT INTO model_usage(singleton,call_limit,token_limit,configuration_hash) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO NOTHING', [settings.callBudget, settings.tokenBudget, configuration]);
        const row = (await db.query('SELECT * FROM model_usage WHERE singleton=true FOR UPDATE')).rows[0];
        if (row.configuration_hash !== configuration)
            throw new Error('model_configuration');
        if (row.calls >= Math.min(row.call_limit, settings.callBudget) - retainedCalls || Number(row.reserved_tokens) + tokens > Math.min(Number(row.token_limit), settings.tokenBudget))
            throw new Error('account_budget');
        await db.query('UPDATE model_usage SET calls=calls+1,reserved_tokens=reserved_tokens+$1 WHERE singleton=true', [tokens]);
    });
}
export async function configureModel(pool: Pool, env: NodeJS.ProcessEnv = process.env) {
    const blocked = (reason: string) => ({ adapter: null, inference: { available: false as const, reason }, report: null });
    if (env.LP_MODEL_LIVE_OPT_IN !== 'true')
        return blocked('Live model access is blocked pending explicit operator configuration and probe.');
    const settings: NemotronSettings = { baseUrl: env.NEMOTRON_BASE_URL ?? '', model: env.NEMOTRON_MODEL ?? '', apiKey: env.NVIDIA_API_KEY ?? '', callBudget: Number(env.LP_MODEL_CALL_BUDGET), tokenBudget: Number(env.LP_MODEL_TOKEN_BUDGET) };
    try {
        const adapter = new HttpNemotronAdapter(settings, fetch, (tokens, retainedCalls) => reserveUsage(pool, settings, tokens, retainedCalls));
        const report = await adapter.probe(AbortSignal.timeout(120000));
        if (!report.available)
            return { adapter: null, inference: { available: false as const, reason: report.reason }, report };
        return { adapter, inference: { available: true as const }, report };
    }
    catch {
        return blocked('Nemotron configuration or finite allowance is unavailable.');
    }
}
