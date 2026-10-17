import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { ArchitecturePanel as ScopedArchitecturePanel } from './architecture-panel';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '22222222-2222-4222-8222-222222222222';
const HOME = '33333333-3333-4333-8333-333333333333';
const BAGS = '44444444-4444-4444-8444-444444444444';
const BOOTS = '55555555-5555-4555-8555-555555555555';

function ArchitecturePanel(props: Readonly<{ projectId: string; crawlId?: string }>) {
  return <ScopedArchitecturePanel workspaceId={WORKSPACE} {...props} />;
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function architecture(overrides: Record<string, unknown> = {}) {
  return {
    state: 'available',
    crawl_id: CRAWL,
    coverage_state: 'complete',
    page_count: 3,
    page_kinds: [
      {
        page_kind: 'product',
        page_count: 2,
        median_depth: 1,
        indexable_count: 2,
        duplicate_metadata_count: 1,
        orphan_count: 1,
      },
      {
        page_kind: 'homepage',
        page_count: 1,
        median_depth: 0,
        indexable_count: 1,
        duplicate_metadata_count: 0,
        orphan_count: 0,
      },
    ],
    nodes: [
      {
        site_url_id: HOME,
        url: 'https://acme.test/',
        title: 'Home',
        page_kind: 'homepage',
        parent_site_url_id: null,
        parent_source: 'unknown',
        depth_from_home: 0,
      },
      ...[
        [BAGS, 'https://acme.test/shop/bags'],
        [BOOTS, 'https://acme.test/shop/boots'],
      ].map(([siteUrlId, url]) => ({
        site_url_id: siteUrlId,
        url,
        title: 'Product',
        page_kind: 'product',
        parent_site_url_id: HOME,
        parent_source: 'breadcrumb',
        depth_from_home: 1,
      })),
    ],
    internal_linking: {
      internal_link_count: 8,
      content_link_count: 5,
      pages_with_incoming_count: 2,
      pages_with_incoming_percentage: 0.6667,
      orphan_page_count: 1,
      orphan_pages: [
        {
          site_url_id: BOOTS,
          url: 'https://acme.test/shop/boots',
          title: 'Boots',
          page_kind: 'product',
        },
      ],
    },
    structure_depth: {
      measured_page_count: 3,
      unmeasured_page_count: 0,
      buckets: [
        { key: 'depth_0', page_count: 1, percentage: 0.3333 },
        { key: 'depth_1', page_count: 2, percentage: 0.6667 },
        { key: 'depth_2', page_count: 0, percentage: 0 },
        { key: 'depth_3_plus', page_count: 0, percentage: 0 },
      ],
    },
    architecture_formula_version: 'sh-architecture-1',
    limitations: [],
    coverage_reasons: [],
    ...overrides,
  };
}

function stubArchitecture(overrides: Record<string, unknown> = {}) {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/site-health/architecture`, () =>
      HttpResponse.json(architecture(overrides)),
    ),
  );
}

describe('Architecture panel', () => {
  it('groups URLs by one page-kind term and shows persisted summaries', async () => {
    stubArchitecture();
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    expect(await screen.findByRole('heading', { name: 'Page kinds' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Observed hierarchy pages' })).toBeInTheDocument();
    // Persisted summaries, not recomputed ones.
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8 including menus')).toBeInTheDocument();
  });

  it('renders the persisted parent hierarchy and relationship source', async () => {
    stubArchitecture();
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    const home = await screen.findByRole('link', { name: 'https://acme.test/' });
    const homeBranch = home.closest('li');
    expect(homeBranch).not.toBeNull();
    expect(
      within(homeBranch!).getByRole('link', { name: 'https://acme.test/shop/bags' }),
    ).toBeInTheDocument();
    expect(within(homeBranch!).getAllByText('Breadcrumb')).toHaveLength(2);
  });

  it('reveals all URLs assigned to a page kind', async () => {
    stubArchitecture();
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    const productButton = await screen.findByRole('button', { name: 'Product' });
    await userEvent.click(productButton);
    const bags = screen.getAllByRole('link', { name: 'https://acme.test/shop/bags' });
    expect(bags).toHaveLength(2);
    expect(bags[0]).toHaveAttribute('href', `/site/crawls/${CRAWL}/pages/${BAGS}`);
    expect(screen.getAllByRole('link', { name: 'https://acme.test/shop/boots' })).toHaveLength(2);
  });

  it('reports the orphan count under partial coverage, scoped to what was crawled', async () => {
    stubArchitecture({ coverage_state: 'partial' });
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    expect(await screen.findByText('Partial coverage')).toBeInTheDocument();
    const orphans = screen.getAllByText('Orphaned pages')[0]!.closest('div');
    expect(within(orphans!).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/withheld/i)).toBeNull();
    // The scope note is what keeps the number honest: it is a claim about the
    // pages this crawl fetched, not about the whole site.
    expect(
      screen.getAllByText('not linked from any page this crawl fetched').length,
    ).toBeGreaterThan(0);
  });

  it('renders an observed zero', async () => {
    stubArchitecture({
      internal_linking: {
        ...architecture().internal_linking,
        orphan_page_count: 0,
        orphan_pages: [],
      },
    });
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    const orphans = (await screen.findAllByText('Orphaned pages'))[0]!.closest('div');
    expect(within(orphans!).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/withheld/i)).toBeNull();
  });

  it('names why coverage fell short instead of only that it did', async () => {
    stubArchitecture({
      coverage_state: 'unknown',
      coverage_reasons: ['discovery_failed', 'frontier_not_exhausted'],
    });
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    expect(await screen.findByText('Coverage unknown')).toBeInTheDocument();
    expect(screen.getByText(/a discovery request failed/)).toBeInTheDocument();
    expect(screen.getByText(/the crawl finished with URLs still queued/)).toBeInTheDocument();
  });

  it('opens the pages the orphan count refers to from the count itself', async () => {
    stubArchitecture();
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);

    // The card shows the number only; the evidence lives behind it. The
    // control is named by what it DOES — "1" alone is not a reason to press it.
    const orphanCount = await screen.findByRole('button', { name: 'View 1 orphaned page' });
    expect(screen.queryByText('Boots')).toBeNull();

    await userEvent.click(orphanCount);

    expect(await screen.findByText('Boots')).toBeInTheDocument();
  });

  it('explains when the persisted projection is unavailable', async () => {
    stubArchitecture({
      state: 'unavailable',
      crawl_id: null,
      coverage_state: 'unknown',
      page_count: 0,
      page_kinds: [],
      nodes: [],
      limitations: ['This crawl has no observed architecture yet.'],
    });
    renderWithProviders(<ArchitecturePanel projectId={PROJECT} crawlId={CRAWL} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This crawl has no observed architecture yet.',
    );
  });
});
