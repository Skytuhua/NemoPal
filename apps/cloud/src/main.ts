import { Pool } from 'pg';
import { buildServer } from './api/server';
import { configureModel } from './jobs/model-settings';
import { JobQueue } from './jobs/queue';
import { startManagerDispatcher } from './jobs/worker';
import { CheckInScheduler, startCheckInDispatcher } from './checkins/scheduler';
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run db:migrate explicitly before start.');
const origin = new URL(process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:4310');
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
    throw new Error('PUBLIC_ORIGIN must use HTTPS outside loopback development.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// pg emits idle-client failures on the pool; never log the error/client object or let it exit Node.
pool.on('error', () => console.error('Cloud database connection unavailable.'));
const model = await configureModel(pool);
const app = buildServer(pool, { inference: model.inference });
const stopManager = startManagerDispatcher(new JobQueue(pool), model.adapter);
const stopCheckins = startCheckInDispatcher(new CheckInScheduler(pool));
const close = async () => { await stopManager(); await stopCheckins(); await app.close(); await pool.end(); };
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
await app.listen({ host: loopback ? '127.0.0.1' : '0.0.0.0', port: Number(process.env.PORT ?? 4310) });
console.log(`Living Playbooks cloud started. Nemotron capability: ${model.inference.available ? 'probe passed' : 'BLOCKED'}.`);
