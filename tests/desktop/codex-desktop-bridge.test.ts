import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { CodexDesktopSession } from '../../apps/desktop/src/main/codex-desktop-session';

const fixture = resolve('tests/desktop/fixtures/demo-app-server.cjs');
const make = () => new CodexDesktopSession(() => ({ executable: process.execPath, args: [fixture] }));

it('keeps a demo-owned conversation for the selected project and reports failed turns', async () => {
  const demo = make();
  try {
    await demo.start('project-a', process.cwd());
    expect(await demo.send('project-a', 'first')).toEqual({ status: 'completed', replies: ['reply first'] });
    expect(await demo.send('project-a', 'fail')).toEqual({ status: 'failed', replies: ['reply fail'] });
    await expect(demo.send('project-b', 'wrong')).rejects.toThrow();
    demo.close();
    await expect(demo.send('project-a', 'after close')).rejects.toThrow();
  } finally { demo.close(); }
});

it('reports an unanswered approval request as an uncertain send and stops the session', async () => {
  const demo = make();
  try {
    await demo.start('project-a', process.cwd());
    expect(await demo.send('project-a', 'approval')).toEqual({ status: 'unknown', replies: [] });
    await expect(demo.send('project-a', 'again')).rejects.toThrow();
  } finally { demo.close(); }
});

it('does not adopt a session whose activation was cancelled while starting', async () => {
  const demo = new CodexDesktopSession(() => ({ executable: process.execPath, args: [fixture, '--delay-start'] }));
  const starting = demo.start('project-a', process.cwd());
  demo.close();
  await expect(starting).rejects.toThrow('cancelled');
  await expect(demo.send('project-a', 'late')).rejects.toThrow();
});
