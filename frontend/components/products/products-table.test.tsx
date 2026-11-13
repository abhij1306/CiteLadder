import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import { commerceQueries } from '@/lib/api/commerce';
import type { CommerceProductRow } from '@citeladder/contracts/commerce-suite';
import type { ProductColumnKey } from '@/lib/products/product-columns';

import { ProductsTable } from './products-table';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ROAD = '22222222-2222-4222-8222-222222222222';
const TRAIL = '33333333-3333-4333-8333-333333333333';
const RIVAL = '44444444-4444-4444-8444-444444444444';
const projectRoute = { projectSelection: { activeProject: makeProject({ id: PROJECT_ID }) } };
const ALL_COLUMNS: ProductColumnKey[] = [
  'visibility',
  'appearances',
  'win_rate',
  'position',
  'mentioned_price',
  'catalog_price',
  'merchants',
];

function row(overrides: Partial<CommerceProductRow>): CommerceProductRow {
  return {
    holder_id: ROAD,
    kind: 'owned',
    name: 'Acme Road Runner',
    brand: 'Acme',
    url: 'https://shop.example/products/road',
    category_ids: [],
    visibility: 0.75,
    appearances: 3,
    ordered_appearances: 3,
    win_rate: 2 / 3,
    position: 4 / 3,
    mentioned_price: { median: 120, currency: 'USD', quoted: 2, other_currency: 1 },
    catalog_price: { min: 120, max: 120, currency: 'USD' },
    merchants: [
      { domain: 'runnerstore.com', count: 2 },
      { domain: 'shoes.example.eu', count: 1 },
    ],
    ...overrides,
  };
}

const ITEMS = [
  row({}),
  row({
    holder_id: RIVAL,
    kind: 'ai_observed_competitor',
    name: 'Zoom Glide',
    brand: 'Zoom',
    visibility: 0,
    appearances: 0,
    ordered_appearances: 0,
    win_rate: null,
    position: null,
    mentioned_price: { median: null, currency: '', quoted: 0, other_currency: 0 },
    catalog_price: null,
    merchants: [],
  }),
  row({
    holder_id: TRAIL,
    name: 'Acme Trail Climber',
    visibility: null,
    appearances: 0,
    ordered_appearances: 0,
    win_rate: null,
    position: null,
    mentioned_price: { median: null, currency: '', quoted: 0, other_currency: 0 },
    catalog_price: null,
    merchants: [],
  }),
];

function Harness({
  columns = ALL_COLUMNS,
  checked = new Set<string>(),
  onCheck = vi.fn(),
  onSort = vi.fn(),
  trackable = false,
  selectable,
}: Readonly<{
  trackable?: boolean;
  selectable?: boolean;
  columns?: ProductColumnKey[];
  checked?: ReadonlySet<string>;
  onCheck?: (ids: string[], checked: boolean) => void;
  onSort?: (sort: string) => void;
}>) {
  const query = useQuery(
    commerceQueries.products({ workspaceId: null, projectId: PROJECT_ID }, 'source=all', null),
  );
  return (
    <ProductsTable
      query={query}
      scope={{ window: '90', engine: 'chatgpt', promptSet: null }}
      columns={columns}
      trackable={trackable}
      {...(selectable === undefined ? {} : { selectable })}
      sort="visibility"
      onSort={onSort}
      checked={checked}
      onCheck={onCheck}
      pageSize={10}
      pager={{ canPrev: false, canNext: false, onPrev: vi.fn(), onNext: vi.fn() }}
    />
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function serve(items: CommerceProductRow[]) {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT_ID}/commerce/products`, () =>
      HttpResponse.json({
        window_days: 30,
        executions: 4,
        total: items.length,
        items,
        next_cursor: null,
      }),
    ),
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;
const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .slice(2)
    .map((cell) => cell.textContent);

describe('ProductsTable', () => {
  it('shows each metric, keeping unavailable, unknown, none and zero apart', async () => {
    serve(ITEMS);
    renderWithProviders(<Harness />, projectRoute);

    await screen.findByText('Acme Road Runner');
    expect(cells('Acme Road Runner')).toEqual([
      '75.0%',
      '3',
      '66.7%',
      '1.3',
      '$120.00+1 in other currencies',
      '$120.00',
      'runnerstore.com (2), shoes.example.eu (1)',
    ]);
    // A competitor seen nowhere in scope: a real zero, no rank, no catalog.
    expect(cells('Zoom Glide')).toEqual([
      '0.0%',
      '0',
      '–Not measured',
      '–Not measured',
      '–Not measured',
      'None',
      'None',
    ]);
    // No answer in scope: visibility is unavailable; a missing catalog price is unknown.
    expect(cells('Acme Trail Climber')).toEqual([
      '–Not measured',
      '0',
      '–Not measured',
      '–Not measured',
      '–Not measured',
      'Unknown',
      'None',
    ]);
  });

  it('links every product to its page in the same window, and keeps competitors out of bulk selection', async () => {
    serve(ITEMS);
    const onCheck = vi.fn();
    renderWithProviders(<Harness onCheck={onCheck} />, projectRoute);

    const page = (name: string) => {
      const href = screen.getByRole('link', { name }).getAttribute('href')!;
      const url = new URL(href, 'https://app.test');
      return `${url.pathname}?${url.searchParams.toString()}`;
    };
    await screen.findByRole('link', { name: 'Acme Road Runner' });
    expect(page('Acme Road Runner')).toBe(`/products/${ROAD}?window=90&engine=chatgpt`);
    expect(page('Zoom Glide')).toBe(`/products/${RIVAL}?window=90&engine=chatgpt`);
    expect(screen.getByRole('checkbox', { name: 'Select Zoom Glide' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all products on this page' }));
    expect(onCheck).toHaveBeenCalledWith([ROAD, TRAIL], true);
  });

  it('lets no archived product be checked for bulk discovery', async () => {
    serve(ITEMS);
    const onCheck = vi.fn();
    renderWithProviders(<Harness selectable={false} onCheck={onCheck} />, projectRoute);

    await screen.findByText('Acme Road Runner');
    expect(screen.getByRole('checkbox', { name: 'Select Acme Road Runner' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all products on this page' }));
    expect(onCheck).toHaveBeenCalledWith([], true);
  });

  it('offers Add to tracking on AI-observed competitor rows only, approving the candidate', async () => {
    serve(ITEMS);
    const sent: unknown[] = [];
    mswServer.use(
      http.patch(`/api/v1/projects/${PROJECT_ID}/commerce/competitors/:id`, async (info) => {
        sent.push([info.params.id, await info.request.json()]);
        return HttpResponse.json({
          id: RIVAL,
          target_kind: 'product',
          target_id: ROAD,
          canonical_url: 'https://zoom.example/glide',
          product_name: 'Zoom Glide',
          brand_name: 'Zoom',
          evidence: {},
          source_kind: 'ai_observed',
          state: 'approved',
          decision_at: '2026-11-11T00:00:00Z',
        });
      }),
    );
    renderWithProviders(<Harness trackable />, projectRoute);

    await screen.findByText('Acme Road Runner');
    expect(
      screen
        .getAllByRole('button', { name: /to tracking/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Add Zoom Glide to tracking']);
    fireEvent.click(screen.getByRole('button', { name: 'Add Zoom Glide to tracking' }));
    await waitFor(() => expect(sent).toEqual([[RIVAL, { decision: 'approved' }]]));
  });

  it('sorts from a metric header and draws only the shown columns', async () => {
    serve(ITEMS);
    const onSort = vi.fn();
    renderWithProviders(<Harness onSort={onSort} columns={['win_rate']} />, projectRoute);

    await screen.findByText('Acme Road Runner');
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      '',
      'Product',
      'Win rate',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Win rate/ }));
    expect(onSort).toHaveBeenCalledWith('win_rate');
  });
});
