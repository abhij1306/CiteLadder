import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as raw, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from 'vite-plus/test';

import { resolveCommandGroups } from '@/components/layout/nav-items';
import { runsQueries } from '@/lib/api/runs';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';
import { makeProject } from '@/test/fixtures/project';
import { testProjectSelection } from '@/test/render';
import { mswServer } from '@/test/msw-server';

const setActiveProjectId = vi.fn();
const acme = makeProject({ id: 'p1', name: 'Acme', brand_name: 'Acme' });
const selection = testProjectSelection({
  projects: [acme, makeProject({ id: 'p2', name: 'Orbit', brand_name: 'Orbit' })],
  activeProjectId: acme.id,
  activeProject: acme,
  setActiveProjectId,
});

import { CommandPalette } from './command-palette';
import { CommandPaletteHost, CommandPaletteTrigger } from './command-palette-launcher';

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

let queryClient = new QueryClient();

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects?project=p1']}>
        <ProjectSelectionProvider value={selection}>
          {children}
          <LocationDisplay />
        </ProjectSelectionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderPalette(ui: ReactElement) {
  return raw(ui, { wrapper: RouterTestWrapper });
}

function Palette() {
  return (
    <>
      <CommandPaletteTrigger />
      <CommandPaletteHost destinations={resolveCommandGroups} />
    </>
  );
}

async function open() {
  const user = userEvent.setup();
  renderPalette(<Palette />);
  await user.click(screen.getByRole('button', { name: /search or jump to/i }));
  await screen.findByRole('listbox');
  return user;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    setActiveProjectId.mockClear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('warms a highlighted destination’s primary read, as a nav link does', async () => {
    const asked: string[] = [];
    mswServer.use(
      http.get('/api/v1/audits', ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
    );
    const user = await open();

    await user.hover(screen.getByRole('option', { name: /^Runs/ }));

    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          runsQueries.list({ workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId: 'p1' })
            .queryKey,
        ),
      ).toEqual([]),
    );
    expect(asked).toEqual(['?project_id=p1']);
  });
  it('renders the trigger closed, advertising its shortcut', () => {
    renderPalette(<Palette />);
    const trigger = screen.getByRole('button', { name: /search or jump to/i });
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the Mac shortcut on macOS', () => {
    const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      renderPalette(<CommandPaletteTrigger />);
      expect(screen.getByText('⌘K')).toBeInTheDocument();
    } finally {
      platform.mockRestore();
    }
  });

  it('opens on Ctrl+K and closes on a second press', async () => {
    const user = userEvent.setup();
    renderPalette(<Palette />);

    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('loads on the first Ctrl+K with focus in its field, and returns focus on close', async () => {
    const user = userEvent.setup();
    renderPalette(
      <>
        <button type="button">Before</button>
        <Palette />
      </>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Before' }));

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const field = within(dialog).getByRole('combobox', { name: 'Search commands' });
    await waitFor(() => expect(field).toHaveFocus());
    await user.keyboard('zzzzz');
    expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzzzz”');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  });

  it('loads from the search button and returns focus to it', async () => {
    const user = await open();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /search or jump to/i })).toHaveFocus();
  });

  it('lists every nav destination and every project', async () => {
    await open();
    expect(screen.getByRole('option', { name: /keyword research/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /site/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /acme/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /orbit/i })).toBeInTheDocument();
  });

  it('drives a grouped listbox from a combobox input', async () => {
    await open();
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    const listbox = screen.getByRole('listbox', { name: 'Commands' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);

    const projects = within(listbox).getByRole('group', { name: 'Switch project' });
    expect(within(projects).getByRole('option', { name: /orbit/i })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('marks the active project so the current scope is obvious', async () => {
    await open();
    expect(screen.getByRole('option', { name: /acme/i })).toHaveTextContent('Current');
    expect(screen.getByRole('option', { name: /orbit/i })).not.toHaveTextContent('Current');
  });

  it('filters on substring across label and group', async () => {
    const user = await open();
    await user.keyboard('site');
    expect(screen.getByRole('option', { name: /site/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^commerce/i })).not.toBeInTheDocument();
  });

  it('navigates to the highlighted route on Enter', async () => {
    const user = await open();
    await user.keyboard('keyword research{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/search-intelligence?project=p1');
  });

  it('deep-links the palette-only tabs and pages under their sidebar group', async () => {
    const user = await open();
    const visits = [
      ['Fact-checking', 'Brand', '/perception?tab=fact-checking&project=p1'],
      ['Query fanouts', 'Tracking', '/visibility?tab=query-fanout&project=p1'],
      ['Prompt builder', 'Tracking', '/prompts/build?project=p1'],
    ] as const;
    for (const [label, group, href] of visits) {
      if (!screen.queryByRole('listbox')) {
        await user.click(screen.getByRole('button', { name: /search or jump to/i }));
      }
      const section = await screen.findByRole('group', { name: group });
      await user.click(within(section).getByRole('option', { name: label }));
      expect(screen.getByTestId('location')).toHaveTextContent(href);
    }
  });

  it('keeps workspace commands out of project scope', async () => {
    const user = await open();
    await user.click(screen.getByRole('option', { name: /^settings$/i }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/settings?workspace=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('switches project through the canonical project destination', async () => {
    const user = await open();
    await user.keyboard('orbit{Enter}');
    expect(setActiveProjectId).toHaveBeenCalledWith('p2');
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?project=p2');
  });

  it('moves the selection with the arrow keys', async () => {
    const user = await open();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}{ArrowUp}');
    const after = screen.getAllByRole('option');
    expect(after[after.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('reports and announces no matches instead of an empty list', async () => {
    const user = await open();
    await user.keyboard('ce');
    const found = screen.getAllByRole('option').length;
    expect(screen.getByRole('status')).toHaveTextContent(`${found} result`);
    await user.keyboard('zzzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('No matches for “cezzzzz”');
    expect(screen.getAllByText('No matches for “cezzzzz”')).toHaveLength(2);
    expect(within(screen.getByRole('listbox')).queryByText(/no matches for/i)).toBeNull();
  });

  it('does not fire a command when nothing matches', async () => {
    const user = await open();
    await user.keyboard('zzzzz{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?project=p1');
    expect(setActiveProjectId).not.toHaveBeenCalled();
  });

  it('returns focus to where the caller was before ⌘K', async () => {
    const user = userEvent.setup();
    renderPalette(
      <>
        <input data-testid="outside" />
        <CommandPalette destinations={resolveCommandGroups} />
      </>,
    );
    const outside = screen.getByTestId('outside');
    outside.focus();

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(outside));
  });

  it('returns focus to the search trigger when opened with nothing focused', async () => {
    const user = userEvent.setup();
    renderPalette(<Palette />);
    expect(document.activeElement).toBe(document.body);

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /search or jump to/i })).toHaveFocus(),
    );
  });

  it('gives the dialog an accessible name without a visible heading', async () => {
    await open();
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });
});
