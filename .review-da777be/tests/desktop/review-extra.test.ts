import { expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';
import { runDemo } from '../../apps/desktop/src/main/codex-demo-cli';
import { createDemoSession } from '../../apps/desktop/src/main/codex-demo';
const fixture = resolve('tests/desktop/fixtures/review-server.cjs');
it('demonstrates dead child is not surfaced until more input', async () => {
 const input = new PassThrough(); let out=''; let settled=false;
 const output = new Writable({write(chunk, _e, done){out += chunk; done();}});
 const running = runDemo({workspace:process.cwd(),executable:process.execPath,args:[fixture,'idle-exit'],input,output}).finally(() => {settled=true;});
 input.write('START\n');
 await new Promise(r => setTimeout(r, 700));
 expect(out).toContain('New demo thread'); expect(settled).toBe(false);
 input.end(); await running;
});
it('demonstrates dropped connection gives no uncertain-send indication', async () => {
 const session = await createDemoSession({workspace:process.cwd(),executable:process.execPath,args:[fixture,'drop'],onReply:()=>{}});
 await expect(session.send('synthetic')).rejects.toThrow('App-server exited');
 session.close();
});
