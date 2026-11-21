import { render } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { ShapeBlocks } from './skeleton-block';

const blocksOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-skeleton-block]'),
];

describe('ShapeBlocks', () => {
  it('draws a thread as the person turn on the right, then the reply on the left', () => {
    const { container } = render(<ShapeBlocks shape={{ kind: 'thread' }} />);
    const blocks = blocksOf(container);
    expect(blocks.map((block) => block.classList.contains('ms-auto'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(blocks.every((block) => block.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('leaves a table row’s desktop-only cells out below the desktop width', () => {
    const { container } = render(
      <ShapeBlocks shape={{ kind: 'table', columns: 3, desktopOnly: 1 }} />,
    );
    const row = blocksOf(container).slice(0, 3);
    expect(row.map((cell) => cell.classList.contains('hidden'))).toEqual([false, false, true]);
  });

  it('draws a tag block only on the fact rows that show a tag', () => {
    const { container } = render(<ShapeBlocks shape={{ kind: 'facts', rows: 3, tagRows: [1] }} />);
    const values = blocksOf(container).filter((_, index) => index % 2 === 1);
    expect(values.map((block) => block.classList.contains('h-6'))).toEqual([false, true, false]);
  });
});
