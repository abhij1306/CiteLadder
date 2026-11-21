import { useQuery } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { renderWithProviders, selectionAs } from '@/test/render';

import { useCatalogHeader } from './catalog-header';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const getDashboard = vi.fn();

vi.mock('@/lib/api/site-health', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/site-health')>('@/lib/api/site-health');
  return { ...actual, siteHealthApi: { ...actual.siteHealthApi, createCrawl: vi.fn() } };
});

vi.mock('@/lib/api/site-health-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/site-health-queries')>(
    '@/lib/api/site-health-queries',
  );
  return {
    ...actual,
    siteHealthQueries: {
      ...actual.siteHealthQueries,
      dashboard: (scope: { workspaceId: string; projectId: string }) => ({
        queryKey: actual.siteHealthQueries.dashboard(scope).queryKey,
        queryFn: () => getDashboard(),
      }),
    },
  };
});

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DASHBOARD_KEY = queryKeys.siteHealth.dashboard({
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
});

const crawl = (overrides: Record<string, unknown> = {}) => ({
  crawl: {
    id: '44444444-4444-4444-8444-444444444444',
    status: 'partially_completed',
    analyzed_count: 49,
    visible_url_count: 50,
    total_url_count: 50,
    ...overrides,
  },
});

const catalogQuery = (overrides: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      products: [{ id: 'p1' }, { id: 'p2' }],
      product_total: 7,
      categories: [{ id: 'c1' }],
      projection: { applicability: 'applicable', in_flight: 0, failed: 0 },
    },
    ...overrides,
  }) as never;

const statValue = (label: string) => screen.getByText(label).closest('dt')?.nextElementSibling;

function CatalogHeaderHost({
  projection,
  ...props
}: Omit<Parameters<typeof useCatalogHeader>[0], 'projection'> & {
  projection?: Parameters<typeof useCatalogHeader>[0]['projection'];
}) {
  const header = useCatalogHeader({
    ...props,
    projection: projection ?? props.query.data?.projection,
  });
  return (
    <>
      {header.stats}
      {header.actions}
      {header.notices}
    </>
  );
}

describe('CatalogHeader', () => {
  beforeEach(() => {
    getDashboard.mockReset();
    getDashboard.mockResolvedValue(crawl());
  });

  it('reads the catalog as metrics, not as prose', async () => {
    renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery()}
      />,
    );

    expect(statValue('Products')).toHaveTextContent('7');
    expect(statValue('Categories')).toHaveTextContent('1');
    await waitFor(() => expect(screen.getByText('49/50')).toBeInTheDocument());
  });

  it('reports the polled projection in flight, then failures, and nothing once clean', async () => {
    const query = catalogQuery({
      data: {
        products: [],
        product_total: 0,
        categories: [],
        projection: { applicability: 'applicable', in_flight: 3, failed: 0 },
      },
    });
    const host = (
      in_flight: number,
      failed: number,
      applicability: 'applicable' | 'not_applicable' | 'unknown' = 'applicable',
    ) => (
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={query}
        projection={{ applicability, in_flight, failed }}
      />
    );
    const { rerender } = renderWithProviders(host(1, 1));
    expect(statValue('Projection')).toHaveTextContent('1 projecting');

    rerender(host(0, 2));
    expect(statValue('Projection')).toHaveTextContent('2 pages not projected');

    rerender(host(0, 0));
    expect(screen.queryByText('Projection')).not.toBeInTheDocument();

    rerender(host(0, 0, 'not_applicable'));
    expect(statValue('Projection')).toHaveTextContent('Not applicable');
    expect(screen.queryByText('Business model unconfirmed')).not.toBeInTheDocument();

    rerender(host(0, 0, 'unknown'));
    expect(screen.queryByText('Projection')).not.toBeInTheDocument();
    expect(screen.getByText('Business model unconfirmed')).toBeInTheDocument();
  });

  it('never prints a progress fraction that reads backwards', async () => {
    getDashboard.mockResolvedValue(crawl({ total_url_count: 1, visible_url_count: 1 }));
    renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery()}
      />,
    );

    await waitFor(() => expect(screen.getByText('49/49')).toBeInTheDocument());
    expect(screen.queryByText('49/1')).not.toBeInTheDocument();
  });

  it('reads the catalog once on arrival, and again only when the analyzed count moves', async () => {
    const readCatalog = vi.fn(async () => ({
      products: [{ id: 'p1' }],
      product_total: 1,
      categories: [],
      projection: { applicability: 'applicable', in_flight: 0, failed: 0 },
    }));
    function LiveScreen() {
      const query = useQuery({
        queryKey: queryKeys.commerce.catalog({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID }),
        queryFn: readCatalog,
      });
      return (
        <CatalogHeaderHost
          workspaceId={WORKSPACE_ID}
          projectId={PROJECT_ID}
          query={query as never}
        />
      );
    }
    const LiveHost = ({ mounted }: { mounted: boolean }) => (mounted ? <LiveScreen /> : null);
    const { queryClient, rerender } = renderWithProviders(<LiveHost mounted />);

    await waitFor(() => expect(screen.getByText('49/50')).toBeInTheDocument());
    await act(async () => {});
    expect(readCatalog).toHaveBeenCalledTimes(1);

    getDashboard.mockResolvedValue(crawl({ analyzed_count: 50 }));
    await act(() => queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }));
    await waitFor(() => expect(screen.getByText('50/50')).toBeInTheDocument());
    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(2));

    rerender(<LiveHost mounted={false} />);
    getDashboard.mockResolvedValue(crawl({ analyzed_count: 51 }));
    queryClient.setQueryData(DASHBOARD_KEY, crawl({ analyzed_count: 51 }));
    rerender(<LiveHost mounted />);
    expect(screen.getByText('51/51')).toBeInTheDocument();
    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(3));
  });

  it('offers the crawl as the primary action until one exists', async () => {
    getDashboard.mockResolvedValue({ crawl: null });
    renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run Site health crawl' })).toBeInTheDocument(),
    );
    expect(statValue('Site health')).toHaveTextContent('Not run yet');
    expect(statValue('Pages analyzed')).toHaveTextContent('Not run yet');
  });

  it('gives an empty catalog its actions once, in the state block, and only to a role that runs', async () => {
    getDashboard.mockResolvedValue({ crawl: null });
    function EmptyHost() {
      const { empty } = useCatalogHeader({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        query: catalogQuery(),
        projection: { applicability: 'unknown', in_flight: 0, failed: 0 } as never,
      });
      return (
        <>
          <header>{empty.dialog}</header>
          <section aria-label="Empty">{empty.actions}</section>
          {empty.businessModelUnconfirmed ? <p>unconfirmed</p> : null}
        </>
      );
    }
    const { unmount } = renderWithProviders(<EmptyHost />, {
      projectSelection: selectionAs('member'),
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run Site health crawl' })).toBeEnabled(),
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Add products',
      'Run Site health crawl',
    ]);
    expect(screen.getByText('unconfirmed')).toBeInTheDocument();
    unmount();

    renderWithProviders(<EmptyHost />, { projectSelection: selectionAs('viewer') });
    expect(await screen.findByText('unconfirmed')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('never reads a failed Site Health read as no crawl, and Refresh reads it again', async () => {
    const { siteHealthApi } = await import('@/lib/api/site-health');
    getDashboard.mockRejectedValue(new ApiError('Bad request', 400, ''));
    const user = userEvent.setup();
    renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery()}
      />,
    );

    await waitFor(() => expect(statValue('Site health')).toHaveTextContent('Unavailable'));
    expect(statValue('Pages analyzed')).toHaveTextContent('Unavailable');
    expect(screen.queryByText('Not run yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh again' })).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: 'Refresh from Site health' });

    getDashboard.mockResolvedValue(crawl());
    await user.click(refresh);
    await waitFor(() => expect(screen.getByText('49/50')).toBeInTheDocument());
    expect(siteHealthApi.createCrawl).not.toHaveBeenCalled();
  });

  it('reports a failed refresh rather than the stale "no crawl" it replaced', async () => {
    getDashboard.mockResolvedValue({ crawl: null });
    const { queryClient } = renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery()}
      />,
    );
    await waitFor(() => expect(statValue('Site health')).toHaveTextContent('Not run yet'));

    getDashboard.mockRejectedValue(new ApiError('Bad request', 400, ''));
    await act(() => queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }));

    await waitFor(() => expect(statValue('Site health')).toHaveTextContent('Unavailable'));
    expect(screen.queryByText('Not run yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh from Site health' })).toBeInTheDocument();
  });

  it('leaves a failed read to the table when the table already reports one', async () => {
    getDashboard.mockRejectedValue(new ApiError('Internal error', 500, ''));
    renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={catalogQuery({ isError: true, data: undefined })}
        tableReadFailed
      />,
    );

    await waitFor(() => expect(statValue('Site health')).toHaveTextContent('Unavailable'));
    expect(statValue('Products')).toHaveTextContent('Unavailable');
    expect(screen.queryByRole('button', { name: 'Refresh again' })).toBeNull();
  });
});
