import type { Locator } from '@playwright/test';

export type Box = readonly number[] | null;

export async function bandBox(part: Locator): Promise<Box> {
  if (!(await part.boundingBox())) return null;
  return part.evaluate((node) => {
    const panel = node.closest('[data-main-column]');
    const frameBottom =
      panel?.getBoundingClientRect().bottom ?? document.documentElement.clientHeight;
    const scrolled = panel ? panel.scrollTop : window.scrollY;
    const box = (rect: DOMRect, offset: number) => [
      rect.x,
      rect.y + offset,
      rect.width,
      rect.height,
    ];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.position === 'fixed') return box(node.getBoundingClientRect(), 0);
      if (style.position !== 'sticky') continue;
      const bottom = Number.parseFloat(style.bottom);
      const rect = element.getBoundingClientRect();
      if (Number.isFinite(bottom) && Math.abs(frameBottom - rect.bottom - bottom) <= 1)
        return box(node.getBoundingClientRect(), 0);
      if (!(element instanceof HTMLElement)) break;
      const inline = element.style.position;
      element.style.position = 'static';
      const flow = node.getBoundingClientRect();
      element.style.position = inline;
      return box(flow, scrolled);
    }
    return box(node.getBoundingClientRect(), scrolled);
  });
}
