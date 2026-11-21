import { describe, expect, it } from 'vite-plus/test';

import { figureRowCells, figureRows } from './figure-rows';

describe('figureRows', () => {
  it.each([
    [2, 358, [2]],
    [3, 358, [2, 1]],
    [4, 358, [2, 2]],
    [5, 358, [2, 2, 1]],
    [6, 358, [2, 2, 2]],
    [3, 380, [2, 1]],
    [3, 400, [3]],
    [3, 420, [3]],
    [2, 480, [2]],
    [3, 480, [3]],
    [4, 480, [2, 2]],
    [5, 480, [3, 2]],
    [6, 480, [3, 3]],
    [2, 734, [2]],
    [3, 734, [3]],
    [4, 734, [4]],
    [5, 734, [3, 2]],
    [6, 734, [3, 3]],
    [2, 1100, [2]],
    [3, 1100, [3]],
    [4, 1100, [4]],
    [5, 1100, [5]],
    [6, 1100, [6]],
    [1, 234, [1]],
    [3, 234, [1, 1, 1]],
    [7, 234, [2, 2, 2, 1]],
    [6, 1008, [6]],
    [6, 950, [3, 3]],
    [6, 563, [3, 3]],
    [7, 1168, [4, 3]],
    [7, 563, [3, 2, 2]],
    [8, 734, [4, 4]],
    [8, 563, [3, 3, 2]],
  ])('lays %i figures in %ipx as %j', (count, width, rows) => {
    expect(figureRows({ count, width })).toEqual(rows);
  });

  it('gives a wrapped row the columns of the first, so its dividers line up', () => {
    expect(figureRowCells({ count: 7, width: 1168 })).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(figureRowCells({ count: 3, width: 234 })).toEqual([1, 1, 1]);
  });

  it('keeps three figures on a row down to 128px cells', () => {
    expect(figureRows({ count: 3, width: 384 })).toEqual([3]);
    expect(figureRows({ count: 3, width: 383 })).toEqual([2, 1]);
  });

  it('holds two a row below 480px, and leaves no figure alone from 480px unless three stack', () => {
    for (let count = 2; count <= 8; count += 1) {
      for (const width of [1168, 1008, 734, 563, 480, 369, 358, 234]) {
        const rows = figureRows({ count, width });
        expect(rows.reduce((sum, size) => sum + size, 0)).toBe(count);
        if (width < 480) expect(Math.max(...rows)).toBeLessThanOrEqual(2);
        else if (!(count === 3 && rows.length === 3)) expect(rows).not.toContain(1);
      }
    }
  });
});
