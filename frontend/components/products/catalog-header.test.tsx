import { useQuery } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { renderWithProviders } from '@/test/render';

import { useCatalogHeader } from './catalog-header';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const getDashboard = vi.fn();

vi.mock('@/lib/api/site-health', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/site-health')>('@/lib/api/site-health');
  return {
    ...actual,
    siteHealthApi: { ...actual.siteHealthApi, createCrawl: vi.fn() },
    // The header reads the dashboard through the shared query factory, so the
    // factory is the seam — replacing `siteHealthApi` alone leaves the
    // factory's own captured reference in place.
    siteHealthQueries: {
      ...actual.siteHealthQueries,
      dashboard: (_workspaceId: string, projectId: string) => ({
        queryKey: ['site-health', 'dashboard', projectId],
        queryFn: () => getDashboard(),
      }),
    },
  };
});

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

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
      // The list is bounded; the count is every product.
      products: [{ id: 'p1' }, { id: 'p2' }],
      product_total: 7,
      categories: [{ id: 'c1' }],
      projection: { applicability: 'applicable', in_flight: 0, failed: 0 },
    },
    ...overrides,
  }) as never;

/** The value a stat label names: the definition after its term. */
const statValue = (label: string) => screen.getByText(label).closest('dt')?.nextElementSibling;

/**
 * The header is a hook now — its two halves go to different bands of the page
 * grammar — so the test mounts a host that renders both, exactly as a screen
 * does, and keeps asserting on what the reader sees.
 */
function CatalogHeaderHost({
  projection,
  ...props
}: Omit<Parameters<typeof useCatalogHeader>[0], 'projection'> & {
  projection?: Parameters<typeof useCatalogHeader>[0]['projection'];
}) {
  // The screen passes the newest projection known; with no poll newer than
  // the catalog, that is the catalog's own.
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
    // The cached catalog was read with three in flight; the header follows
    // the newer projection poll rather than the catalog's own copy.
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

    // A business that does not sell a catalog, and one whose model is not yet
    // confirmed, each say so rather than reading as a clean projection.
    rerender(host(0, 0, 'not_applicable'));
    expect(statValue('Projection')).toHaveTextContent('Not applicable');

    rerender(host(0, 0, 'unknown'));
    expect(statValue('Projection')).toHaveTextContent('Business model unconfirmed');
  });

  it('never prints a progress fraction that reads backwards', async () => {
    // The crawl counters can disagree mid-flight (and did: a sitemap-driven
    // crawl reported a one-page "total" for fifty admitted URLs, which the
    // header rendered as "49/1"). Analyzed pages are proof the inventory is at
    // least that large, so the denominator can never fall below them.
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
        queryKey: queryKeys.commerce.catalog(PROJECT_ID),
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
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ['site-health', 'dashboard', PROJECT_ID] }),
    );
    await waitFor(() => expect(screen.getByText('50/50')).toBeInTheDocument());
    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(2));

    // Away from Products the dashboard moves on while the catalog stays fresh
    // in the cache; coming back re-reads the catalog for the newer count.
    rerender(<LiveHost mounted={false} />);
    getDashboard.mockResolvedValue(crawl({ analyzed_count: 51 }));
    queryClient.setQueryData(
      ['site-health', 'dashboard', PROJECT_ID],
      crawl({ analyzed_count: 51 }),
    );
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
      expect(screen.getByRole('button', { name: 'Run Site Health crawl' })).toBeInTheDocument(),
    );
    expect(screen.getByText('No crawl yet')).toBeInTheDocument();
    expect(statValue('Pages analyzed')).toHaveTextContent('Not measured');
  });
});
