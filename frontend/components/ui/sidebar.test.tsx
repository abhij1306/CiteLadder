import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { emitResize } from '@/test/resize-observer';

import { SidebarNavGroup, SidebarScrollList } from './sidebar';

function setHeights(node: HTMLElement, heights: { scroll: number; client: number }) {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: heights.scroll });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: heights.client });
}

describe('SidebarScrollList', () => {
  it('fades its bottom when a group grows taller than the list, without a scroll event', () => {
    const { container } = render(
      <SidebarScrollList label="Pages" revealKey="/projects">
        <SidebarNavGroup title="Track">
          <li>Prompts</li>
        </SidebarNavGroup>
      </SidebarScrollList>,
    );
    const list = container.querySelector<HTMLElement>('[data-sidebar-scroll]')!;
    const group = list.querySelector('nav')!.firstElementChild!;
    expect(list.dataset.fadeBottom).toBeUndefined();

    setHeights(list, { scroll: 401, client: 400 });
    act(() => emitResize(group));
    expect(list.dataset.fadeBottom).toBeUndefined();

    setHeights(list, { scroll: 480, client: 400 });
    act(() => emitResize(group));

    expect(list.dataset.fadeBottom).toBe('true');
    expect(list.dataset.fadeTop).toBeUndefined();
  });

  it('scrolls a current row under the bottom fade clear of it on navigation', () => {
    const list = (key: string) => (
      <SidebarScrollList label="Pages" revealKey={key}>
        <SidebarNavGroup>
          <li>
            <a href="/performance" aria-current={key === '/performance' ? 'page' : undefined}>
              Performance
            </a>
          </li>
        </SidebarNavGroup>
      </SidebarScrollList>
    );
    const { container, rerender } = render(list('/projects'));
    const scroller = container.querySelector<HTMLElement>('[data-sidebar-scroll]')!;
    const row = container.querySelector('a')!;
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    scroller.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 400 });
    row.getBoundingClientRect = () => DOMRect.fromRect({ y: 352 - scrollTop, height: 32 });

    rerender(list('/performance'));
    expect(scrollTop).toBe(16);

    rerender(list('/projects'));
    scrollTop = 0;
    scroller.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 60 });
    row.getBoundingClientRect = () => DOMRect.fromRect({ y: 28 - scrollTop, height: 32 });
    rerender(list('/performance'));
    expect(scrollTop).toBe(14);
  });
});
