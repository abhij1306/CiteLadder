import { describe, expect, it } from 'vite-plus/test';

import { togglePage, toggleRow, type RowSelection } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const ticked = (selection: RowSelection) => [...selection.ids].sort();
const none: RowSelection = { ids: new Set(), anchor: null };

describe('row selection', () => {
  it('ranges from the last clicked row in either direction, unticking as it ticks', () => {
    const first = toggleRow(none, { order, id: 'b', checked: true, range: false });
    const down = toggleRow(first, { order, id: 'd', checked: true, range: true });
    expect([ticked(down), down.anchor]).toEqual([['b', 'c', 'd'], 'd']);
    const up = toggleRow(down, { order, id: 'c', checked: false, range: true });
    expect(ticked(up)).toEqual(['b']);
  });

  it('ticks only the row when the anchor left the shown rows or there is none', () => {
    const plain = toggleRow(none, { order, id: 'c', checked: true, range: true });
    expect(ticked(plain)).toEqual(['c']);
    const stale = toggleRow(
      { ids: new Set(['z']), anchor: 'z' },
      { order, id: 'e', checked: true, range: true },
    );
    expect(ticked(stale)).toEqual(['e', 'z']);
  });

  it('ticks and unticks a page without moving the anchor', () => {
    const start: RowSelection = { ids: new Set(['a']), anchor: 'a' };
    const all = togglePage(start, ['c', 'd'], true);
    expect([ticked(all), all.anchor]).toEqual([['a', 'c', 'd'], 'a']);
    expect(ticked(togglePage(all, ['a', 'c'], false))).toEqual(['d']);
  });
});
