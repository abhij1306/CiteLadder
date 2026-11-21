import { describe, expect, it } from 'vite-plus/test';

import { hiddenLowColumns, type FitColumn } from './data-table-fit';

const column = (floor: number, low = false): FitColumn => ({ floor, low });

describe('table fit', () => {
  it('hides low columns, the last first, only until the floors fit the frame', () => {
    const prompts = [
      column(200),
      column(112),
      column(128),
      column(112, true),
      column(96, true),
      column(80),
      column(80),
    ];
    expect(hiddenLowColumns({ columns: prompts, select: 40, frame: 848 })).toEqual([]);
    expect(hiddenLowColumns({ columns: prompts, select: 40, frame: 800 })).toEqual([4]);
    expect(hiddenLowColumns({ columns: prompts, select: 40, frame: 700 })).toEqual([3, 4]);
    expect(hiddenLowColumns({ columns: prompts, select: 40, frame: 400 })).toEqual([3, 4]);
  });
});
