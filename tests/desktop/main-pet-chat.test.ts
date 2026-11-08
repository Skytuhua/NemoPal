import { expect, test, vi } from 'vitest';
import { PetChatStateSchema } from '@living-playbooks/contracts';
import { startSyntheticMain, projectSnapshot } from './main-harness';

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
