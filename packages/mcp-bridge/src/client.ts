import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LocalThreadReadInputSchema, LocalThreadSendInputSchema, LocalThreadHistorySchema, LocalThreadReceiptSchema, type LocalThreadReadInput, type LocalThreadSendInput } from '@living-playbooks/contracts';
import { createThreadMcpServer, type T3Runner } from './index';

export function createLocalThreadClient(threadId: string | undefined, run: T3Runner) {
  let connection: Promise<Client> | undefined, server: ReturnType<typeof createThreadMcpServer> | undefined;
  let closed = false, sending = false;
  async function connect() {
    if (closed) throw Error('Local thread client closed');
    return connection ??= (async () => {
      server = createThreadMcpServer(threadId ?? '', run);
      const client = new Client({ name: 'nemopal-desktop', version: '0.1.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return client;
    })();
  }
  return {
    async read(input: LocalThreadReadInput) {
      const args = LocalThreadReadInputSchema.parse(input);
      const result = await (await connect()).callTool({ name: 'read_thread', arguments: args });
      if (result.isError) throw Error('Local T3 thread read unavailable');
      return LocalThreadHistorySchema.parse(result.structuredContent);
    },
    async send(input: LocalThreadSendInput) {
      const args = LocalThreadSendInputSchema.parse(input);
      if (sending) throw Error('Local thread send already in progress');
      sending = true;
      try {
        const result = await (await connect()).callTool({ name: 'send_message', arguments: args });
        if (result.isError) throw Error('Message may have been queued. Read the thread before retrying.');
        return LocalThreadReceiptSchema.parse(result.structuredContent);
      } finally { sending = false; }
    },
    async close() {
      closed = true;
      const client = await connection?.catch(() => undefined);
      await client?.close(); await server?.close();
    },
  };
}
