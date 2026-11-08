import { Pool } from 'pg';
import { startCloudApplication } from './application';
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run db:migrate explicitly before start.');
const origin = new URL(process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:4310');
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
    throw new Error('PUBLIC_ORIGIN must use HTTPS outside loopback development.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// pg emits idle-client failures on the pool; never log the error/client object or let it exit Node.
pool.on('error', () => console.error('Cloud database connection unavailable.'));
const application = await startCloudApplication({ pool, env: process.env, listen: { host: loopback ? '127.0.0.1' : '0.0.0.0', port: Number(process.env.PORT ?? 4310) } });
const close = () => { void application.close().catch(() => { console.error('Cloud shutdown failed.'); process.exitCode = 1; }); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
console.log(`Living Playbooks cloud started. Nemotron capability: ${application.inferenceAvailable ? 'probe passed' : 'BLOCKED'}.`);
