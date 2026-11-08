import type { Rectangle } from './windows';

/** All coordinates are Electron screen DIP, including negative display origins. */
export function popupPlacement(pet: Rectangle, area: Rectangle, expanded: boolean): Rectangle {
  const margin = Math.min(12, Math.max(0, Math.floor((Math.min(area.width, area.height) - 1) / 2)));
  const width = Math.max(1, Math.min(expanded ? 560 : 360, area.width - margin * 2));
  const height = Math.max(1, Math.min(expanded ? 640 : 460, area.height - margin * 2));
  const right = pet.x + 236, spriteTop = pet.y + 148;
  const candidates = [
    { x: right - width, y: spriteTop - 12 - height },
    { x: right - width, y: pet.y + 280 + 12 },
    { x: right + 12, y: pet.y + 280 - height },
    { x: pet.x + 56 - 12 - width, y: pet.y + 280 - height },
  ];
  const fits = (point: { x: number; y: number }) => point.x >= area.x + margin && point.y >= area.y + margin && point.x + width <= area.x + area.width - margin && point.y + height <= area.y + area.height - margin;
  const point = candidates.find(fits) ?? candidates[0]!;
  return { x: Math.round(Math.max(area.x + margin, Math.min(point.x, area.x + area.width - margin - width))), y: Math.round(Math.max(area.y + margin, Math.min(point.y, area.y + area.height - margin - height))), width, height };
}
