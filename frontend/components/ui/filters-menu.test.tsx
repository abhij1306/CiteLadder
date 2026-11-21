import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { choiceFilter } from './all-filters';
import { FiltersMenu } from './filters-menu';

const PROMPTS = Array.from({ length: 12 }, (_, index) => ({
  value: `p${index + 1}`,
  label: `Prompt number ${index + 1}`,
}));

function Page() {
  const [surface, setSurface] = useState<'all' | 'chatgpt' | 'gemini'>('all');
  const [prompt, setPrompt] = useState('every');
  return (
    <>
      <FiltersMenu
        filters={[
          choiceFilter({
            id: 'surface',
            label: 'Surface',
            value: surface,
            defaultValue: 'all',
            groups: [
              { options: [{ value: 'all', label: 'All surfaces' }] },
              {
                label: 'Answer engines',
                options: [
                  { value: 'chatgpt', label: 'ChatGPT' },
                  { value: 'gemini', label: 'Gemini' },
                ],
              },
            ],
            onChange: setSurface,
          }),
          choiceFilter({
            id: 'prompt',
            label: 'Prompt',
            value: prompt,
            defaultValue: 'every',
            groups: [{ options: [{ value: 'every', label: 'Every prompt' }, ...PROMPTS] }],
            onChange: setPrompt,
          }),
        ]}
      />
      <output data-testid="selection">{`${surface} ${prompt}`}</output>
    </>
  );
}

describe('FiltersMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists each filter with its value, checks the selected option and counts what is set', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const [surface, prompt, ...rest] = screen.getAllByRole('menuitem');
    expect(surface).toHaveAccessibleName('Surface: All surfaces');
    expect(prompt).toHaveAccessibleName('Prompt: Every prompt');
    expect(rest).toHaveLength(0);

    await user.click(screen.getByRole('menuitem', { name: 'Surface: All surfaces' }));
    expect(screen.getByRole('menuitemradio', { name: 'All surfaces' })).toBeChecked();
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}{Enter}');

    expect(screen.getByTestId('selection')).toHaveTextContent('gemini every');
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Filters (1)' }));
    const set = screen.getByRole('menuitem', { name: 'Surface: Gemini' });
    set.focus();
    await user.keyboard('{ArrowRight}');
    (await screen.findByRole('menuitem', { name: 'Reset to all surfaces' })).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('selection')).toHaveTextContent('all every');
  });

  it('searches a long list and picks from it with the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Page />);
    screen.getByRole('button', { name: 'Filters' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');

    const search = screen.getByRole('searchbox', { name: 'Search prompt' });
    expect(search).toHaveFocus();
    await user.keyboard('number 1');
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Prompt number 1',
      'Prompt number 10',
      'Prompt number 11',
      'Prompt number 12',
    ]);
    await user.keyboard('1{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Prompt number 11' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(screen.getByTestId('selection')).toHaveTextContent('all p11');
  });

  it('types into a custom filter field opened with the keyboard alone', async () => {
    function FolderPage() {
      const [folder, setFolder] = useState('');
      return (
        <>
          <FiltersMenu
            filters={[
              {
                kind: 'custom',
                id: 'folder',
                label: 'Folder',
                valueLabel: folder || 'Any folder',
                isDefault: !folder,
                defaultLabel: 'Any folder',
                reset: () => setFolder(''),
                content: (
                  <input
                    aria-label="Folder"
                    value={folder}
                    onChange={(event) => setFolder(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                ),
              },
            ]}
          />
          <output data-testid="folder">{folder}</output>
        </>
      );
    }
    const user = userEvent.setup();
    render(<FolderPage />);
    screen.getByRole('button', { name: 'Filters' }).focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowRight}');

    expect(screen.getByRole('textbox', { name: 'Folder' })).toHaveFocus();
    await user.keyboard('/blog');
    expect(screen.getByTestId('folder')).toHaveTextContent('/blog');
    expect(screen.getByRole('menuitem', { name: /^Folder/ })).toHaveTextContent('/blog');
  });

  it('on a phone opens a filter in the menu itself, with a way back to the list', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 639px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('menuitem', { name: 'Surface: All surfaces' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'All surfaces',
      'ChatGPT',
      'Gemini',
    ]);

    await user.click(screen.getByRole('menuitem', { name: 'Filters' }));
    expect(screen.getByRole('menuitem', { name: 'Prompt: Every prompt' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Surface: All surfaces' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'ChatGPT' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('chatgpt every');
  });

  it('draws nothing for a page with no filters', () => {
    render(
      <>
        <FiltersMenu filters={[]} />
        <button type="button">Other</button>
      </>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Other']);
  });
});
