import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executable = existsSync(edge) ? edge : chromium.executablePath();
test.skipIf(!existsSync(executable))('offline and waiting sprites animate unless either motion preference disables them', async () => {
  const css = await readFile('apps/web/src/pet/pet-mouse.css', 'utf8');
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    await page.setContent(`<style>${css}</style><main class="pet-surface" data-reduced-motion="false"><span class="pet-art pet-mouse state-offline"></span><span class="pet-art pet-mouse state-waiting_for_you"></span></main>`);
    const names = () => page.locator('.pet-mouse').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName));
    expect(await names()).toEqual(['pet-mouse-idle', 'pet-mouse-idle']);
    await page.locator('main').evaluate(el => el.setAttribute('data-reduced-motion', 'true'));
    expect(await names()).toEqual(['none', 'none']);
    await page.locator('main').evaluate(el => el.setAttribute('data-reduced-motion', 'false'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await names()).toEqual(['none', 'none']);
  } finally { await browser.close(); }
});
