import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { FiltersMenu } from '@/components/ui/filters-menu';

import { sourceTableFilters } from './source-filters';

const TYPES = [
  { token: 'editorial', label: 'Editorial' },
  { token: 'ugc', label: 'UGC' },
];

describe('Sources filters', () => {
  it('lists the page-only filters for URLs alone, and keeps a set filter with one option', () => {
    const filters = (
      dimension: 'domain' | 'url',
      typeValue: string | null,
      types = TYPES,
      standing: { gapOnly: boolean; onChange: () => void } | null = {
        gapOnly: true,
        onChange: vi.fn(),
      },
    ) =>
      sourceTableFilters({
        dimension,
        type: { value: typeValue, options: types, onChange: vi.fn() },
        standing,
        domain: { value: null, options: ['a.com', 'b.com'], onChange: vi.fn() },
      }).map((filter) => `${filter.label}: ${filter.valueLabel}`);

    expect(filters('domain', null)).toEqual(['Domain type: All domain types']);
    expect(filters('url', 'ugc')).toEqual([
      'URL type: UGC',
      'Standing: Gaps: competitors listed, not you',
      'Domain: All domains',
    ]);
    expect(filters('url', 'ugc', TYPES, null)).toEqual(['URL type: UGC', 'Domain: All domains']);
    expect(filters('domain', null, [TYPES[0]!])).toEqual([]);
    expect(filters('domain', 'editorial', [TYPES[0]!])).toEqual(['Domain type: Editorial']);
  });

  it('clears the standing back to every page from its submenu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FiltersMenu
        filters={sourceTableFilters({
          dimension: 'url',
          type: { value: null, options: [], onChange: vi.fn() },
          standing: { gapOnly: true, onChange },
          domain: null,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filters (1)' }));
    await user.keyboard('{ArrowDown}{ArrowRight}{Enter}');
    expect(onChange.mock.calls).toEqual([[null]]);
  });
});
