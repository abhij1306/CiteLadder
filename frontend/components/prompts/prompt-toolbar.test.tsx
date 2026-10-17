import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { emptyFilters } from '@/lib/prompts/filter';
import { renderWithProviders } from '@/test/render';

import { PromptActions, PromptFilterControls } from './prompt-toolbar';

describe('PromptFilterControls', () => {
  it('keeps search controlled and lets the reader clear it', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [search, setSearch] = useState('citation');
      return (
        <PromptFilterControls
          search={search}
          onSearchChange={setSearch}
          filters={emptyFilters}
          onFiltersChange={() => undefined}
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
