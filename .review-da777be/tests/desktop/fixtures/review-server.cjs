const readline = require('node:readline');
const send = x => process.stdout.write(JSON.stringify(x) + '\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({id:m.id,result:{}});
  if (m.method === 'thread/start') { send({id:m.id,result:{thread:{id:'owned'}}}); if (process.argv[2] === 'idle-exit') setTimeout(() => process.exit(0), 100); }
  if (m.method === 'turn/start') { if (process.argv[2] === 'drop') process.exit(0); }
});
