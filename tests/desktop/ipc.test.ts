import { describe, expect, it } from 'vitest';
import { NativeBoundary } from '../../apps/desktop/src/main/ipc';
import { fixtureIds as ids } from '../../fixtures/contracts/golden';

const sender = (role = 'workspace', url = 'file:///app/index.html') => ({ role, senderId: 8, frameId: 9, topFrameId: 9, url });
function boundary() {
  const executed: unknown[] = [];
  const guard = new NativeBoundary({ workspace: { senderId: 8, frameId: 9, url: 'file:///app/index.html' }, pet: { senderId: 10, frameId: 11, url: 'file:///app/index.html?surface=pet' } }, {
    projects: new Set([ids.project]), checkIns: new Map([[ids.checkIn, ids.project]]), documents: new Map([[ids.document, ids.project]]), jobs: new Map(),
  }, async (operation, input) => { executed.push({ operation, input }); return { ok: true }; });
  return { guard, executed };
}
describe('native IPC authority', () => {
  it('denies arbitrary operations, extra fields and cross-project commands before dispatch', async () => {
    const { guard, executed } = boundary();
    for (const input of [{ type: 'exec', command: 'whoami' }, { type: 'listProjects', url: 'https://evil.test' }, { type: 'getSnapshot', projectId: ids.owner }]) {
      await expect(guard.call(sender(), 'invoke', input)).rejects.toThrow();
    }
    expect(executed).toEqual([]);
    await guard.call(sender(), 'invoke', { type: 'getSnapshot', projectId: ids.project });
    expect(executed).toEqual([{ operation: 'invoke', input: { type: 'getSnapshot', projectId: ids.project } }]);
  });
  it('rejects child frames, wrong webContents, navigation and pet source powers', async () => {
    const { guard, executed } = boundary();
    for (const context of [{ ...sender(), topFrameId: 1 }, { ...sender(), senderId: 3 }, sender('workspace', 'https://evil.test'), sender('workspace', 'file:///app/index.html?surface=pet')]) {
      await expect(guard.call(context, 'capabilities')).rejects.toThrow();
    }
    await expect(guard.call({ ...sender('pet', 'file:///app/index.html?surface=pet'), senderId: 10, frameId: 11, topFrameId: 11 }, 'selectSource', ids.project)).rejects.toThrow();
    expect(executed).toEqual([]);
  });
});
