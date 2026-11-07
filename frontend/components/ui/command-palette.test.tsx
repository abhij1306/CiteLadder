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
import { mswServer } from '@/test/msw-server';

// Hoisted so the mock factories below — which vitest lifts above these
// statements — can reference the state safely rather than relying on the
// factories happening to run lazily.
const { setActiveProjectId, projectContext } = vi.hoisted(() => {
  const setActiveProjectId = vi.fn();
  return {
    setActiveProjectId,
    projectContext: {
      projects: [
        { id: 'p1', brand_name: 'Acme' },
        { id: 'p2', brand_name: 'Orbit' },
      ],
      activeProjectId: 'p1',
      activeWorkspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      activeProject: { id: 'p1', workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      setActiveProjectId,
    },
  };
});

vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => projectContext,
}));

import { CommandPalette, CommandPaletteTrigger } from './command-palette';

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

let queryClient = new QueryClient();

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects?project=p1']}>
        {children}
        <LocationDisplay />
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
      <CommandPalette destinations={resolveCommandGroups} />
    </>
  );
}

/** Opens via the sidebar trigger and returns the user-event instance. */
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

  it('lists every nav destination and every project', async () => {
    await open();
    // Layer destinations, plus both projects.
    expect(screen.getByRole('option', { name: /demand/i })).toBeInTheDocument();
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
    await user.keyboard('demand{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/demand?project=p1');
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

    // Wraps backwards past the start to the last result.
    await user.keyboard('{ArrowUp}{ArrowUp}');
    const after = screen.getAllByRole('option');
    expect(after[after.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('reports no matches instead of an empty list', async () => {
    const user = await open();
    await user.keyboard('zzzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    // The message is not an option, so it sits outside the listbox.
    expect(screen.getByText(/no matches for/i)).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).queryByText(/no matches for/i)).toBeNull();
  });

  it('does not fire a command when nothing matches', async () => {
    const user = await open();
    await user.keyboard('zzzzz{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?project=p1');
    expect(setActiveProjectId).not.toHaveBeenCalled();
  });

  it('returns focus to where the caller was before ⌘K', async () => {
    // Radix restores focus to its own Trigger; the shortcut path has none, so
    // without an explicit hand-back focus falls to <body> and the caller
    // loses their place in the page.
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

  it('gives the dialog an accessible name without a visible heading', async () => {
    await open();
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });
});
