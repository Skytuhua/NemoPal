import { expect, it } from 'vitest';
import { clampPosition, CompanionLifetime, securePreferences, rendererTargets } from '../../apps/desktop/src/main/windows';

it('a second instance cannot start observers; Hide keeps companion running and Quit flushes before exit', async () => {
  const events: string[] = [];
  const lifetime = new CompanionLifetime(() => { events.push('hide'); }, async () => { events.push('stop'); }, async () => { events.push('flush'); }, () => { events.push('quit'); });
  expect(lifetime.acquire(() => false)).toBe(false);
  expect(events).toEqual(['quit']);
  events.length = 0;
  expect(lifetime.acquire(() => true)).toBe(true);
  lifetime.closeWorkspace();
  expect(events).toEqual(['hide']);
  await lifetime.quit();
  await lifetime.quit();
  expect(events).toEqual(['hide', 'stop', 'flush', 'quit']);
});
it('uses role-specific sandbox preloads, frozen pet route and clamps removed monitors', () => {
  expect(securePreferences('/preload/pet.cjs')).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, preload: '/preload/pet.cjs' });
  expect(rendererTargets('file:///build/index.html')).toEqual({ workspace: 'file:///build/index.html', pet: 'file:///build/index.html?surface=pet', petChat: 'file:///build/index.html?surface=pet-chat' });
  expect(() => rendererTargets('https://remote.test')).toThrow();
  expect(clampPosition({ x: 9000, y: -500 }, { width: 240, height: 240 }, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toEqual({ x: 1680, y: 0 });
});
