import { expect, test, vi } from 'vitest';
import { PetChatStateSchema } from '@living-playbooks/contracts';
import { startSyntheticMain, projectSnapshot, deferred } from './main-harness';
import { localBinding } from '../../fixtures/codex/synthetic';

test('popup read and resize keep selected B under pinned A; hide fences chat and tray restores only pet', async () => {
  const main = await startSyntheticMain();
  try {
    const a = projectSnapshot('A'), b = projectSnapshot('B');
    await main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id });
    const preference = { hidden: false, focus: true, reducedMotion: true, pinnedProjectId: a.project.id };
    await main.invoke('setPetPreference', preference);
    await main.petInvoke({ type: 'openChat', contextId: main.petEvents.at(-1)!.chatContextId });
    const firstWindow = main.windows.petChat;
    const state = PetChatStateSchema.parse(await main.chatInvoke('petChatRead'));
    expect(state.conversation?.projectId).toBe(a.project.id);
    expect(state.conversation?.messages[0]?.text).toBe(a.messages[0]!.text);
    await main.chatInvoke('petChatInvoke', { type: 'expand', contextId: state.contextId, expanded: true });
    expect(main.windows.petChat).toBe(firstWindow);
    expect(main.desktopEvents.some(event => event.type === 'open_project')).toBe(false);
    await main.invoke('setPetPreference', { ...preference, hidden: true });
    expect(main.windows.pet.hide).toHaveBeenCalled(); expect(main.windows.hideChat).toHaveBeenCalled();
    await expect(main.chatInvoke('petChatInvoke', { type: 'expand', contextId: state.contextId, expanded: true })).rejects.toThrow();
    await main.invoke('setPetPreference', { ...preference, pinnedProjectId: null });
    expect(main.petEvents.at(-1)?.projectId).toBe(b.project.id);
    expect(main.windows.destroyChat).toHaveBeenCalled();
    expect(main.chatEvents.at(-1)?.visible).toBe(false);
  } finally { await main.close(); }
});


test('failed popup flush leaves IPC usable and a second quit can finish', async () => {
  const main = await startSyntheticMain({ chatFlushReplies: [false, true] });
  try {
    const a = projectSnapshot('A');
    await main.invoke('setPetPreference', { hidden: false, focus: true, reducedMotion: true, pinnedProjectId: a.project.id });
    await main.petInvoke({ type: 'openChat', contextId: main.petEvents.at(-1)!.chatContextId });
    main.clickTray('quit');
    await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    const state = PetChatStateSchema.parse(await main.chatInvoke('petChatRead'));
    expect(state.flushRequestId).toBeUndefined();
    await main.chatInvoke('petChatInvoke', { type: 'expand', contextId: state.contextId, expanded: true });
    main.clickTray('quit');
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
  } finally { await main.dispose(); }
});


test('source stop failure restores the popup and permits quit retry', async () => {
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, false) });
  main.observer.stop.mockRejectedValueOnce(Error('Synthetic observer stop failure'));
  const reads = main.observer.readDelta.mock.calls.length;
  try {
    const a = projectSnapshot('A');
    await main.invoke('setPetPreference', { hidden: false, focus: true, reducedMotion: true, pinnedProjectId: a.project.id });
    await main.petInvoke({ type: 'openChat', contextId: main.petEvents.at(-1)!.chatContextId });
    main.clickTray('quit');
    await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    const state = PetChatStateSchema.parse(await main.chatInvoke('petChatRead'));
    expect(state.visible).toBe(true); expect(state.flushRequestId).toBeUndefined();
    await main.chatInvoke('petChatInvoke', { type: 'expand', contextId: state.contextId, expanded: true });
    main.tick(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
    await expect(main.invoke('selectSource', a.project.id)).rejects.toThrow();
    main.clickTray('quit'); await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
    expect(main.observer.stop).toHaveBeenCalledTimes(2);
  } finally { await main.dispose(); }
});


test('an older resume cannot replace a controller after source stop fails during quit', async () => {
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, false) });
  const resumeStop = deferred<void>();
  main.observer.stop.mockReturnValueOnce(resumeStop.promise).mockRejectedValueOnce(Error('Synthetic observer stop failure'));
  try {
    main.powerMonitor.emit('resume');
    await vi.waitFor(() => expect(main.observer.stop).toHaveBeenCalledTimes(1));
    main.clickTray('quit'); await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    resumeStop.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
    const reads = main.observer.readDelta.mock.calls.length;
    main.tick(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
    main.clickTray('quit'); await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
    expect(main.observer.stop).toHaveBeenCalledTimes(3);
  } finally { resumeStop.resolve(); await main.dispose(); }
});
