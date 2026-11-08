import { Pool } from 'pg';
import { runCloudProcess, startCloudApplication } from './application';
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run db:migrate explicitly before start.');
const origin = new URL(process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:4310');
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
    throw new Error('PUBLIC_ORIGIN must use HTTPS outside loopback development.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// pg emits idle-client failures on the pool; never log the error/client object or let it exit Node.
pool.on('error', () => console.error('Cloud database connection unavailable.'));
await runCloudProcess({
    signals: process,
    start: signal => startCloudApplication({ pool, env: process.env, listen: { host: loopback ? '127.0.0.1' : '0.0.0.0', port: Number(process.env.PORT ?? 4310) }, signal }),
    onStarted: application => console.log(`NemoPal cloud started. Nemotron capability: ${application.inferenceAvailable ? 'probe passed' : 'BLOCKED'}.`),
    onShutdownError: () => { console.error('Cloud shutdown failed.'); process.exitCode = 1; },
});
