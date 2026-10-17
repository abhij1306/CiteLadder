import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

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
      products: [{ id: 'p1' }, { id: 'p2' }],
      categories: [{ id: 'c1' }],
      projection: { applies: true, in_flight: 0, failed: 0 },
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
function CatalogHeaderHost(props: Parameters<typeof useCatalogHeader>[0]) {
  const header = useCatalogHeader(props);
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

    expect(statValue('Products')).toHaveTextContent('2');
    expect(statValue('Categories')).toHaveTextContent('1');
    await waitFor(() => expect(screen.getByText('49/50')).toBeInTheDocument());
  });

  it('reports projection work in flight, then failures, and nothing once clean', async () => {
    const withProjection = (in_flight: number, failed: number) =>
      catalogQuery({
        data: {
          products: [],
          categories: [],
          projection: { applies: true, in_flight, failed },
        },
      });
    const { rerender } = renderWithProviders(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={withProjection(3, 1)}
      />,
    );
    expect(statValue('Projection')).toHaveTextContent('3 projecting');

    rerender(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={withProjection(0, 2)}
      />,
    );
    expect(statValue('Projection')).toHaveTextContent('2 pages not projected');

    rerender(
      <CatalogHeaderHost
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        query={withProjection(0, 0)}
      />,
    );
    expect(screen.queryByText('Projection')).not.toBeInTheDocument();
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
