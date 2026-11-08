const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let initialized = false;
let count = 0;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') return send({ id: request.id, result: {} });
  if (request.method === 'initialized') { initialized = true; return; }
  if (!initialized) process.exit(2);
  if (request.method === 'thread/start') {
    if (!request.params.cwd || request.params.sandbox !== 'read-only' || request.params.approvalPolicy !== 'never') process.exit(3);
    if (process.argv[2] === 'exit-idle') setTimeout(() => process.exit(0), 40);
    return send({ id: request.id, result: { thread: { id: 'demo-owned' } } });
  }
  if (request.method !== 'turn/start' || request.params.threadId !== 'demo-owned') process.exit(4);
  const text = request.params.input[0].text;
  if (text === 'lost') process.exit(0);
  if (text === 'malformed') return send({ id: request.id });
  if (text === 'rejected') return send({ id: request.id, error: { code: -32600, message: 'rejected' } });
  const turnId = `turn-${++count}`;
  if (text === 'approval') return send({ id: 100, method: 'item/commandExecution/requestApproval', params: { threadId: 'demo-owned' } });
  send({ method: 'item/completed', params: { threadId: 'foreign', turnId, item: { type: 'agentMessage', id: 'foreign', text: 'foreign secret' } } });
  send({ method: 'turn/completed', params: { threadId: 'foreign', turn: { id: turnId, status: 'failed', error: { message: 'foreign failure' } } } });
  send({ method: 'item/completed', params: { threadId: 'demo-owned', turnId, item: { type: 'agentMessage', id: `item-${count}`, text: `reply ${text}` } } });
  send({ method: 'turn/completed', params: { threadId: 'demo-owned', turn: { id: turnId, status: text === 'fail' ? 'failed' : 'completed', error: text === 'fail' ? { message: 'synthetic failure' } : null } } });
  send({ id: request.id, result: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
});
