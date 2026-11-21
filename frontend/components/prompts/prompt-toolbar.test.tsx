import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { emptyFilters } from '@/lib/prompts/filter';

import { FilterBar } from '@/components/ui/filter-bar';
import { chooseFilterOption, openFilterRow } from '@/test/all-filters';

import { TabsRoot } from '@/components/ui/tabs';

import { PromptStatusTabs, promptFilterControls } from './prompt-toolbar';

describe('promptFilterControls', () => {
  it('keeps search controlled and lets the reader clear it', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [search, setSearch] = useState('citation');
      return (
        <FilterBar
          {...promptFilterControls({
            search,
            onSearchChange: setSearch,
            filters: emptyFilters,
            onFiltersChange: () => undefined,
          })}
        />
      );
    }

    render(<Harness />);
    const search = screen.getByRole('searchbox', { name: 'Search prompts' });
    expect(search).toHaveValue('citation');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    await user.type(search, 'brand');
    expect(search).toHaveValue('brand');
  });

  it('switches between active and archived prompts, each with its count', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [status, setStatus] = useState<'active' | 'archived'>('active');
      return (
        <TabsRoot value={status} onValueChange={setStatus}>
          <PromptStatusTabs counts={{ active: 12, archived: 3 }} />
        </TabsRoot>
      );
    }

    render(<Harness />);
    // jsdom drops the space the browser reads between label and count.
    const archived = screen.getByRole('tab', { name: /^Archived\s*\(3\)$/ });
    const active = screen.getByRole('tab', { name: /^Active\s*\(12\)$/ });
    expect(active).toHaveAttribute('aria-selected', 'true');
    await user.click(archived);
    expect(archived).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveAttribute('aria-selected', 'false');
  });
});

describe('promptFilterControls filters', () => {
  it('offers Enabled and Branded as one choice each, marking a chosen one, and clears both at once', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [filters, setFilters] = useState(emptyFilters);
      return (
        <FilterBar
          {...promptFilterControls({
            search: '',
            onSearchChange: () => undefined,
            filters,
            onFiltersChange: setFilters,
          })}
        />
      );
    }

    render(<Harness />);
    await chooseFilterOption(user, 'Branded', 'Branded only');
    expect(await openFilterRow(user, 'Branded', 'Branded only')).toHaveAttribute('data-active');
    expect(await openFilterRow(user, 'Enabled', 'All prompts')).toBeVisible();
    await user.keyboard('{Escape}');
    await chooseFilterOption(user, 'Enabled', 'Disabled only');
    expect(screen.getByRole('button', { name: 'Remove Enabled filter' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Branded: All prompts' })).not.toHaveAttribute(
      'data-active',
    );
    expect(screen.queryByRole('button', { name: 'Remove Enabled filter' })).toBeNull();
  });
});
