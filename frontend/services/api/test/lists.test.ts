import { describe, expect, it } from 'vitest';
import { firstOf, groupBy, lastOf, onlyOf } from '../src/lists.ts';

describe('list reads', () => {
  it('reads the first item, and names the expected item when there is none', () => {
    expect(firstOf(['a', 'b'], 'the inserted row')).toBe('a');
    expect(() => firstOf([], 'the inserted row')).toThrow('Expected the inserted row');
  });

  it('reads the last item of a non-empty list', () => {
    expect(lastOf(['a'])).toBe('a');
    expect(lastOf(['a', 'b', 'c'])).toBe('c');
    expect(lastOf(['a', null])).toBeNull();
  });

  it('reads the item only when the collection holds exactly one', () => {
    expect(onlyOf(['a'])).toBe('a');
    expect(onlyOf(new Set(['a', 'a']))).toBe('a');
    expect(onlyOf(['a', 'b'])).toBeUndefined();
  });

  it('groups rows by key in first-seen order', () => {
    const rows = [
      { key: 'b', n: 1 },
      { key: 'a', n: 2 },
      { key: 'b', n: 3 },
    ];
    expect(
      [...groupBy(rows, (row) => row.key)].map(([key, group]) => [key, group.map((row) => row.n)]),
    ).toEqual([
      ['b', [1, 3]],
      ['a', [2]],
    ]);
  });
});
