import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { emptyFilters } from '@/lib/prompts/filter';
import { renderWithProviders } from '@/test/render';

import { FilterBar } from '@/components/ui/filter-bar';
import { chooseFilterOption, openFilterRow } from '@/test/all-filters';

import { PromptActions, promptFilterControls } from './prompt-toolbar';

describe('promptFilterControls', () => {
  it('keeps search controlled and lets the reader clear it', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [search, setSearch] = useState('citation');
      return (
        <FilterBar
          {...promptFilterControls({
            status: {
              value: 'active',
              counts: { active: 0, archived: 0 },
              onChange: () => undefined,
            },
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
        <FilterBar
          {...promptFilterControls({
            status: { value: status, counts: { active: 12, archived: 3 }, onChange: setStatus },
            search: '',
            onSearchChange: () => undefined,
            filters: emptyFilters,
            onFiltersChange: () => undefined,
          })}
        />
      );
    }

    render(<Harness />);
    // jsdom drops the space the browser reads between label and count.
    const archived = screen.getByRole('radio', { name: /^Archived\s*\(3\)$/ });
    const active = screen.getByRole('radio', { name: /^Active\s*\(12\)$/ });
    expect(active).toBeChecked();
    await user.click(archived);
    expect(archived).toBeChecked();
    expect(active).not.toBeChecked();
  });
});

describe('promptFilterControls filters', () => {
  it('offers Enabled and Branded as one choice each in All filters, counting a chosen one', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [filters, setFilters] = useState(emptyFilters);
      return (
        <FilterBar
          {...promptFilterControls({
            status: { value: 'active', counts: { active: 1, archived: 0 }, onChange: () => {} },
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
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'All filters (1)' })).toBeInTheDocument();
    expect(await openFilterRow(user, 'Branded', 'Branded only')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Enabled: All' })).toBeVisible();
  });
});

describe('PromptActions', () => {
  it('offers Launch audit only once the project has an active prompt', () => {
    const projectId = '44444444-4444-4444-8444-444444444444';
    const selection = {
      activeProject: { id: projectId } as never,
      activeProjectId: projectId,
      status: 'ready' as const,
    };
    const actions = (hasActivePrompts: boolean) => (
      <PromptActions
        onImport={() => undefined}
        onAdd={() => undefined}
        onGenerate={() => undefined}
        hasActivePrompts={hasActivePrompts}
      />
    );

    const { rerender } = renderWithProviders(actions(false), { projectSelection: selection });
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeDisabled();

    rerender(actions(true));
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeEnabled();
  });
});
