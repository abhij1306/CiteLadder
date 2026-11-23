import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  prefetchQuery: vi.fn((_options: { queryKey: readonly unknown[] }) => Promise.resolve()),
  find: vi.fn((_filters: { queryKey: readonly unknown[] }) => undefined),
  actionsList: { status_counts: { open: 3, in_progress: 2, completed: 9 } },
  chats: [
    {
      id: '33333333-3333-4333-8333-333333333331',
      title: 'Why did citations drop',
      origin: 'chat',
      last_activity_at: '2026-11-12T10:00:00Z',
      running: true,
    },
  ],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.actionsList, isLoading: false }),
  useInfiniteQuery: () => ({
    data: { pages: [{ items: mocks.chats }] },
    isPending: false,
    isError: false,
    isFetching: false,
    hasNextPage: false,
  }),
  infiniteQueryOptions: <T,>(options: T) => options,
  useQueryClient: () => ({
    prefetchQuery: mocks.prefetchQuery,
    getQueryCache: () => ({ find: mocks.find }),
  }),
  queryOptions: <T,>(options: T) => options,
}));

let pathname = '/site';
let searchParams = new URLSearchParams();

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) =>
    createElement('a', { ...props, href: to }, children),
  useLocation: () => ({ pathname, search: '' }),
  useSearchParams: () => [searchParams, vi.fn()],
}));

import { performanceQueries } from '@/lib/api/performance';
import { INITIAL_VISIBILITY_PARAMS } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { INITIAL_DASHBOARD_PARAMS } from '@/lib/performance/performance';
import { navigationMode } from '@/lib/navigation/app-routes';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';
import { makeProject } from '@/test/fixtures/project';
import { projectScope, testProjectSelection } from '@/test/render';
import { AgentNav } from '@/components/agent/agent-nav';
import { ModeSwitch } from './mode-switch';
import { DashboardNav, SidebarFootNav } from './sidebar-nav';

const selection = testProjectSelection(
  projectScope(
    makeProject({
      id: '11111111-1111-4111-8111-111111111111',
      workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
  ),
);

function SidebarNav() {
  return (
    <ProjectSelectionProvider value={selection}>
      <div data-sidebar-state="expanded">
        <ModeSwitch rail={false} />
        {navigationMode(pathname) === 'agent' ? <AgentNav /> : <DashboardNav />}
        <SidebarFootNav rail={false} />
      </div>
    </ProjectSelectionProvider>
  );
}

const SCOPE = {
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: '11111111-1111-4111-8111-111111111111',
};
const PERFORMANCE_LANDING_KEY = performanceQueries.dashboard(
  SCOPE,
  INITIAL_DASHBOARD_PARAMS,
).queryKey;

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
    expect(screen.getByRole('link', { name: 'Site health' })).toHaveAttribute(
      'href',
      '/site?project=11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/settings?tab=integrations&workspace=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('shows open and in-progress Actions as the Actions count', async () => {
    render(<SidebarNav />);
    expect(
      await screen.findByRole('link', { name: 'Actions, 5 open Actions' }, { timeout: 4_500 }),
    ).toHaveAttribute('href', '/actions?project=11111111-1111-4111-8111-111111111111');
  });

  it('keeps a screen current on every one of its tabs', () => {
    pathname = '/site';
    searchParams = new URLSearchParams('tab=internal-links');
    const { unmount } = render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Site health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    unmount();

    pathname = '/settings';
    searchParams = new URLSearchParams('tab=members');
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Integrations' })).not.toHaveAttribute('aria-current');
  });

  it('marks Shopping current, not also Products below it', () => {
    pathname = '/products/overview';
    const { unmount } = render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Shopping' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Products' })).not.toHaveAttribute('aria-current');
    unmount();

    pathname = '/products/22222222-2222-4222-8222-222222222222';
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Shopping' })).not.toHaveAttribute('aria-current');
  });

  it('lists the mode of the route: Actions and the analysis pages in Dashboard only', async () => {
    pathname = '/actions';
    const first = render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /^Actions/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Site health' })).toBeInTheDocument();
    first.unmount();

    pathname = '/agent/skills';
    const { unmount } = render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Agent' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: /^Actions/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'New chat' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Why did citations drop/ })).toHaveAttribute(
      'href',
      '/agent/chats/33333333-3333-4333-8333-333333333331?project=11111111-1111-4111-8111-111111111111',
    );
    expect(screen.queryByRole('link', { name: 'Site health' })).toBeNull();
    unmount();

    pathname = '/site';
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('link', { name: /^Actions/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Site health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('link', { name: 'Skills' })).toBeNull();
  });

  it('sends each destination and each mode to its front door, whatever was opened before', () => {
    pathname = '/actions/44444444-4444-4444-8444-444444444441';
    render(<SidebarNav />).unmount();
    pathname = '/agent/chats/33333333-3333-4333-8333-333333333331';
    render(<SidebarNav />).unmount();
    pathname = '/site';
    searchParams = new URLSearchParams('tab=pages');
    render(<SidebarNav />).unmount();

    pathname = '/search-intelligence';
    searchParams = new URLSearchParams();
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: 'Agent' })).toHaveAttribute(
      'href',
      '/agent?project=11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('link', { name: /^Actions/ })).toHaveAttribute(
      'href',
      '/actions?project=11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('link', { name: 'Site health' })).toHaveAttribute(
      'href',
      '/site?project=11111111-1111-4111-8111-111111111111',
    );
  });

  it('folds a group to the current page alone, and keeps the fold', () => {
    pathname = '/site';
    const { unmount } = render(<SidebarNav />);
    const analyze = screen.getByRole('button', { name: 'Website' });
    expect(analyze).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(analyze);
    expect(analyze).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Issues' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Site health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    unmount();

    pathname = '/runs';
    render(<SidebarNav />);
    expect(screen.getByRole('button', { name: 'Website' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: 'Site health' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(screen.getByRole('link', { name: 'Issues' })).toBeInTheDocument();
  });

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

  it('warms the Visibility landing selection the screen actually reads', async () => {
    render(<SidebarNav />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Sources' }));
    await waitFor(() => expect(mocks.prefetchQuery).toHaveBeenCalled());
    const keys = mocks.prefetchQuery.mock.calls.map((call) => call[0].queryKey);
    expect(keys).toContainEqual(
      visibilityQueries.project(SCOPE, INITIAL_VISIBILITY_PARAMS).queryKey,
    );
  });
});
