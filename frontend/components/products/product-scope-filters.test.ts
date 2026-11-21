import { describe, expect, it, vi } from 'vite-plus/test';

import { categoryFilter } from './product-scope-filters';

const COFFEE = '22222222-2222-4222-8222-222222222222';
const SINGLE = '33333333-3333-4333-8333-333333333333';
const GIFTS = '44444444-4444-4444-8444-444444444444';

const catalog = {
  product_total: 1240,
  categories: [
    { id: COFFEE, name: 'Coffee', parent_id: null, product_count: 812 },
    { id: GIFTS, name: 'Gifts', parent_id: null, product_count: 0 },
    { id: SINGLE, name: 'Single Origin', parent_id: COFFEE, product_count: 6 },
  ],
};

describe('categoryFilter', () => {
  it('lists every category under its parent with its path and product count', () => {
    const filter = categoryFilter(null, catalog, vi.fn());
    if (filter.kind !== 'choice') throw new Error('expected a choice filter');
    expect(filter.groups.flatMap((group) => group.options.map((option) => option.label))).toEqual([
      'All categories · 1,240',
      'Coffee · 812',
      'Coffee › Single Origin · 6',
      'Gifts · 0',
    ]);
    expect(filter.isDefault).toBe(true);
  });

  it('narrows to the chosen category and back to every category', () => {
    const onChange = vi.fn();
    const filter = categoryFilter(SINGLE, catalog, onChange);
    if (filter.kind !== 'choice') throw new Error('expected a choice filter');
    expect(filter.valueLabel).toBe('Coffee › Single Origin · 6');
    filter.onChange(GIFTS);
    filter.onChange(filter.groups[0]!.options[0]!.value);
    expect(onChange.mock.calls).toEqual([[GIFTS], [null]]);
  });
});
