import { pathToFileURL } from 'node:url';
import { checkLocalT3Connection, T3ConnectionError } from '../apps/cloud/src/integrations/t3/client/index';

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: pnpm exec tsx scripts/t3-connect.ts --endpoint <local HTTP MCP URL>');
    console.log('Finite local check: owner-approved read-only OAuth, MCP initialize and tools/list. No tool calls or saved credentials.');
    return 0;
  }
  if (args.length !== 2 || args[0] !== '--endpoint' || !args[1]) {
    console.error('Supply --endpoint with your local MCP URL. Use --help for usage.'); return 2;
  }
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    console.log('Starting a dedicated local read-only connection check.');
    const receipt = await checkLocalT3Connection({ endpoint: args[1], signal: cancellation.signal,
      onAuthorization(url) {
        console.log('Open this local link yourself. Verify the client name, select Read only, and approve in T3.');
        console.log('Keep the link private; do not paste it into chat, files, or GitHub. The check expires in three minutes.');
        console.log(url);
      } });
    console.log(JSON.stringify(receipt)); return 0;
  } catch (error) {
    const safe = error instanceof T3ConnectionError ? error : new T3ConnectionError('http_error', 'configuration');
    console.error(JSON.stringify({ status: 'failed', code: safe.code, phase: safe.phase, delivery: safe.delivery,
      message: safe.message, toolCalls: 0 })); return 1;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
