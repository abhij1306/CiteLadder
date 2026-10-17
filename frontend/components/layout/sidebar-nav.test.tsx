import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  prefetchQuery: vi.fn((_options: { queryKey: readonly unknown[] }) => Promise.resolve()),
  // `prefetchRoute` skips keys whose query already failed, so the stub client
  // needs the cache lookup that guard performs. Nothing has failed here.
  find: vi.fn((_filters: { queryKey: readonly unknown[] }) => undefined),
  // The Actions list read behind the open count.
  actionsList: { status_counts: { open: 3, in_progress: 2, completed: 9 } },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.actionsList }),
  useQueryClient: () => ({
    prefetchQuery: mocks.prefetchQuery,
    getQueryCache: () => ({ find: mocks.find }),
  }),
  // Query-options factories are typed identity at runtime; the route
  // prefetchers call them to build the key asserted below.
  queryOptions: <T,>(options: T) => options,
}));

vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => ({
    activeProject: { id: '11111111-1111-4111-8111-111111111111' },
    activeProjectId: '11111111-1111-4111-8111-111111111111',
    activeWorkspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
}));

let pathname = '/site';
let searchParams = new URLSearchParams();

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) =>
    createElement('a', { ...props, href: to }, children),
  useLocation: () => ({ pathname, search: '' }),
  useSearchParams: () => [searchParams, vi.fn()],
}));

import { SidebarNav } from './sidebar-nav';

// The key the Performance screen's own landing selection reads, so a hover
// warms exactly the entry the destination consumes.
const PERFORMANCE_LANDING_KEY = [
  'performance',
  'dashboard',
  '11111111-1111-4111-8111-111111111111',
  { range: 'last_synced', granularity: 'day', compare: 'none' },
];

describe('station navigation', () => {
  beforeEach(() => {
    pathname = '/site';
    searchParams = new URLSearchParams();
    window.sessionStorage.clear();
    mocks.prefetchQuery.mockClear();
    mocks.find.mockClear();
  });

  it('scopes project destinations to the project and setup to the workspace', () => {
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      '/site?project=11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/settings?tab=integrations&workspace=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('shows open and in-progress Actions as the Actions count in Dashboard mode', () => {
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Actions, 5 open' })).toHaveAttribute(
      'href',
      '/agent/actions?project=11111111-1111-4111-8111-111111111111',
    );
  });

  it('keeps a screen current on every one of its tabs', () => {
    pathname = '/site';
    searchParams = new URLSearchParams('tab=internal-links');
    const { unmount } = render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('aria-current', 'page');
    unmount();

    // A destination that names a tab is current only on that tab.
    pathname = '/settings';
    searchParams = new URLSearchParams('tab=members');
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Integrations' })).not.toHaveAttribute('aria-current');
  });

  it('calls the compact drawer close owner after choosing a destination', () => {
    const onNavigate = vi.fn();
    render(<SidebarNav onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Website' }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('derives the Dashboard | Agent mode from the route', () => {
    pathname = '/site';
    const { unmount } = render(<SidebarNav />);
    const modes = screen.getByRole('navigation', { name: 'Mode' });
    expect(within(modes).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(modes).getByRole('link', { name: 'Agent' })).toHaveAttribute(
      'href',
      '/agent?project=11111111-1111-4111-8111-111111111111',
    );
    unmount();

    pathname = '/agent/actions';
    render(<SidebarNav />);
    expect(
      within(screen.getByRole('navigation', { name: 'Mode' })).getByRole('link', {
        name: 'Agent',
      }),
    ).toHaveAttribute('aria-current', 'page');
    // Agent mode replaces the Dashboard stations.
    expect(screen.queryByRole('link', { name: 'Website' })).not.toBeInTheDocument();
  });

  it('returns each mode to the last route it used for the project', () => {
    pathname = '/agent/skills';
    const { unmount } = render(<SidebarNav />);
    unmount();

    pathname = '/demand';
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Agent' })).toHaveAttribute(
      'href',
      '/agent/skills?project=11111111-1111-4111-8111-111111111111',
    );
  });

  // Intent warms the key, but no longer in the same tick: each prefetcher
  // imports its API module on demand, so that the ten domains this map reaches
  // stay out of the chunk the browser needs before it can paint anything.
  it('prefetches the destination primary query on pointer and keyboard intent', async () => {
    render(<SidebarNav />);
    const performance = screen.getByRole('link', { name: 'Performance' });
    fireEvent.mouseEnter(performance);
    await waitFor(() => expect(mocks.prefetchQuery).toHaveBeenCalled());
    expect(mocks.prefetchQuery.mock.calls[0]?.[0].queryKey).toEqual(PERFORMANCE_LANDING_KEY);

    mocks.prefetchQuery.mockClear();
    mocks.find.mockClear();
    fireEvent.focus(performance);
    await waitFor(() => expect(mocks.prefetchQuery).toHaveBeenCalledOnce());
    expect(mocks.prefetchQuery.mock.calls[0]?.[0].queryKey).toEqual(PERFORMANCE_LANDING_KEY);
  });

  /**
   * The same contract for AI Visibility: intent must warm the key the screen
   * itself reads. A key spelled out in the prefetcher drifted from the
   * selection the dashboard builds and warmed an entry nothing consumed.
   */
  it('warms the Visibility landing selection the screen actually reads', async () => {
    render(<SidebarNav />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'AI Visibility' }));
    await waitFor(() => expect(mocks.prefetchQuery).toHaveBeenCalled());
    const keys = mocks.prefetchQuery.mock.calls.map((call) => call[0].queryKey);
    expect(keys).toContainEqual([
      'visibility',
      'project',
      '11111111-1111-4111-8111-111111111111',
      'latest',
      { cohort: 'core', selection_mode: 'latest' },
    ]);
  });
});
