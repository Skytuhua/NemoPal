import { expect, test } from 'vitest';
import { popupPlacement } from '../../apps/desktop/src/main/popup-placement';

test('anchors above the sprite, clamps negative origins and fits small work areas without changing the pet', () => {
  const pet = { x: -420, y: 600, width: 240, height: 280 };
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  expect(popupPlacement(pet, area, false)).toEqual({ x: -544, y: 276, width: 360, height: 460 });
  expect(pet).toEqual({ x: -420, y: 600, width: 240, height: 280 });
  for (const expanded of [false, true]) {
    const bounds = popupPlacement(pet, { x: -300, y: -200, width: 280, height: 320 }, expanded);
    expect(bounds.x).toBeGreaterThanOrEqual(-288); expect(bounds.y).toBeGreaterThanOrEqual(-188);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(-32);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(108);
  }
});
test('expanded is bounded to 560 by 640 and falls below or beside a top-edge pet', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = popupPlacement({ x: 300, y: 0, width: 240, height: 280 }, area, true);
  expect(bounds.width).toBe(560); expect(bounds.height).toBe(640);
  expect(bounds.y).toBeGreaterThanOrEqual(12); expect(bounds.x).toBeGreaterThanOrEqual(12);
});
