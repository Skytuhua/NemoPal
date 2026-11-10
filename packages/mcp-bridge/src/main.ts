import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createThreadMcpServer } from './index';
import { createT3Runner } from './t3-cli';

try {
  const server = createThreadMcpServer(process.env.NEMOPAL_T3_THREAD_ID ?? '', createT3Runner(process.env.NEMOPAL_T3_CLI || undefined));
  await server.connect(new StdioServerTransport());
} catch {
  console.error('NemoPal thread MCP unavailable. Set NEMOPAL_T3_THREAD_ID to the selected T3 thread UUID and verify the installed T3 CLI.');
  process.exitCode = 1;
}
