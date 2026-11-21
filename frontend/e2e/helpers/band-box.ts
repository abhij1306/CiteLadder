import type { Locator } from '@playwright/test';

export type Box = readonly number[] | null;

export async function bandBox(part: Locator): Promise<Box> {
  const box = await part.boundingBox();
  if (!box) return null;
  const { pinned, scrolled } = await part.evaluate((node) => {
    const panel = node.closest('[data-main-column]');
    const frame = panel?.getBoundingClientRect() ?? {
      top: 0,
      bottom: document.documentElement.clientHeight,
    };
    const held = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.position === 'fixed') return true;
      if (style.position !== 'sticky') return false;
      const rect = element.getBoundingClientRect();
      const top = Number.parseFloat(style.top);
      const bottom = Number.parseFloat(style.bottom);
      return (
        (Number.isFinite(top) && Math.abs(rect.top - frame.top - top) <= 1) ||
        (Number.isFinite(bottom) && Math.abs(frame.bottom - rect.bottom - bottom) <= 1)
      );
    };
    let pinned = false;
    for (let element: Element | null = node; element && !pinned; element = element.parentElement)
      pinned = held(element);
    return { pinned, scrolled: panel ? panel.scrollTop : window.scrollY };
  });
  return [box.x, box.y + (pinned ? 0 : scrolled), box.width, box.height];
}
