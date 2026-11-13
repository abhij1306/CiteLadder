import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { AllFilters } from '@/components/ui/all-filters';
import { FilterBar } from '@/components/ui/filter-bar';
import { SegmentedControl } from '@/components/ui/tabs';

import { sourceTableFilters } from './source-filters';
import { sourceTableToolbar } from './source-toolbar';

const TYPES = [
  { token: 'editorial', label: 'Editorial' },
  { token: 'ugc', label: 'UGC' },
];

describe('Sources filters', () => {
  it('lists the page-only filters for URLs alone, and keeps a set filter with one option', () => {
    const filters = (dimension: 'domain' | 'url', typeValue: string | null, types = TYPES) =>
      sourceTableFilters({
        dimension,
        type: { value: typeValue, options: types, onChange: vi.fn() },
        standing: { value: 'gap', onChange: vi.fn() },
        domain: { value: null, options: ['a.com', 'b.com'], onChange: vi.fn() },
      }).map((filter) => `${filter.label}: ${filter.valueLabel}`);

    expect(filters('domain', null)).toEqual(['Domain type: All domain types']);
    expect(filters('url', 'ugc')).toEqual([
      'URL type: UGC',
      'Standing: Gaps: competitors listed, not you',
      'Domain: All domains',
    ]);
    // One option is nothing to choose between, unless it is already filtering.
    expect(filters('domain', null, [TYPES[0]!])).toEqual([]);
    expect(filters('domain', 'editorial', [TYPES[0]!])).toEqual(['Domain type: Editorial']);
  });

  it('clears the standing back to every page from its submenu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AllFilters
        filters={sourceTableFilters({
          dimension: 'url',
          type: { value: null, options: [], onChange: vi.fn() },
          standing: { value: 'near_miss', onChange },
          domain: null,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'All filters (1)' }));
    await user.keyboard('{ArrowDown}{ArrowRight}{Enter}');
    expect(onChange.mock.calls).toEqual([[null]]);
  });

  it('leads the table toolbar with the Domains | URLs switch, before the search', () => {
    render(
      <FilterBar
        {...sourceTableToolbar({
          dimension: 'domain',
          view: (
            <SegmentedControl
              value="domain"
              onChange={vi.fn()}
              options={[
                { value: 'domain', label: 'Domains' },
                { value: 'url', label: 'URLs' },
              ]}
              ariaLabel="Source dimension"
            />
          ),
          search: '',
          onSearch: vi.fn(),
          rows: [],
          domain: null,
        })}
      />,
    );
    const toolbar = screen.getByRole('group', { name: 'Search and filters' });
    const inOrder = [...toolbar.querySelectorAll('[role="radio"], input, button:not([role])')].map(
      (control) => control.getAttribute('aria-label') ?? control.textContent,
    );
    expect(inOrder).toEqual(['Domains', 'URLs', 'Search domains', 'Export']);
  });
});
