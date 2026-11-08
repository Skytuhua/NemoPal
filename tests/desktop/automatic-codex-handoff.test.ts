import { expect, it, vi } from 'vitest';
import { AutomaticCodexHandoff } from '../../apps/desktop/src/main/automatic-codex-handoff';

it('leaves work pending without a consented selected session', async () => {
  const claim = vi.fn();
  const handoff = new AutomaticCodexHandoff({ ready: () => null, claim, send: vi.fn(), finish: vi.fn() });
  await handoff.run('project');
  expect(claim).not.toHaveBeenCalled();
});

it('sends a claimed request once and reports untrusted output', async () => {
  const claim = vi.fn().mockResolvedValue({ id: 'request', taskId: 'task', text: 'Do the task' });
  const send = vi.fn().mockResolvedValue({ status: 'completed', replies: ['untrusted reply'] });
  const finish = vi.fn().mockResolvedValue(undefined);
  const handoff = new AutomaticCodexHandoff({ ready: () => 'session', claim, send, finish });
  await handoff.run('project');
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('project', 'Manager request for task task:\nDo the task');
  expect(finish).toHaveBeenCalledWith('project', 'request', { status: 'completed', replies: ['untrusted reply'] });
});

it('never sends after an uncertain claim or a changed session', async () => {
  let ready = true;
  const send = vi.fn();
  const finish = vi.fn();
  const claim = vi.fn().mockImplementationOnce(async () => { throw Error('response lost'); }).mockImplementationOnce(async () => { ready = false; return { id: 'request', taskId: 'task', text: 'Do the task' }; });
  const handoff = new AutomaticCodexHandoff({ ready: () => ready ? 'session' : null, claim, send, finish });
  await expect(handoff.run('project')).rejects.toThrow('response lost');
  await handoff.run('project');
  expect(send).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith('project', 'request', { status: 'unknown', replies: [] });
});
