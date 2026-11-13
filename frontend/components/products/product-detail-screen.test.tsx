import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { chooseFilterOption } from '@/test/all-filters';
import { renderWithProviders, selectionAs, type TestRole } from '@/test/render';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';

import { ProductDetailScreen } from './product-detail-screen';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ROAD = '22222222-2222-4222-8222-222222222222';
const RIVAL = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';
const AUDIT = '77777777-7777-4777-8777-777777777777';
const ACTION = '88888888-8888-4888-8888-888888888888';
const PROMPT = '99999999-9999-4999-8999-999999999999';
const projectRoute = { projectSelection: { activeProject: makeProject({ id: PROJECT_ID }) } };
const base = `/api/v1/projects/${PROJECT_ID}/commerce`;

const ROAD_DETAIL: CommerceProductDetail = {
  window_days: 90,
  executions: 4,
  product: {
    holder_id: ROAD,
    kind: 'owned',
    name: 'Acme Road Runner',
    brand: 'Acme',
    url: 'https://shop.example/products/road',
    category_ids: [],
    visibility: 0.75,
    appearances: 3,
    ordered_appearances: 3,
    win_rate: null,
    position: 4 / 3,
    mentioned_price: { median: null, currency: 'USD', quoted: 0, other_currency: 0 },
    catalog_price: { min: 120, max: 120, currency: 'USD' },
    merchants: [],
    description: 'A daily trainer for road miles.',
    image_url: null,
    catalog: {
      lifecycle_state: 'active',
      price: 120,
      currency: 'USD',
      sku: 'RR-1',
      gtin: '',
      mpn: '',
      image_url: '',
      categories: ['Road'],
    },
  },
  competing: [
    {
      holder_id: RIVAL,
      kind: 'approved_competitor',
      name: 'Rival Pacer',
      brand: 'Rival',
      shared: 2,
      ahead: 1,
      position: 1.5,
    },
  ],
  merchants: [{ domain: 'runnerstore.com', count: 2 }],
  sources: [
    {
      url: 'https://reviews.example/best-road',
      title: 'Best road shoes',
      domain: 'reviews.example',
      count: 1,
    },
  ],
  fan_out_queries: [],
  prompts: [
    {
      prompt_id: PROMPT,
      text: 'best running shoes for road',
      executions: 4,
      appearances: 3,
      visibility: 0.75,
      win_rate: null,
      position: 4 / 3,
    },
  ],
  answers: [
    {
      task_id: TASK,
      audit_id: AUDIT,
      prompt_text: 'best running shoes for road',
      engine: 'chatgpt',
      completed_at: '2026-11-01T00:00:00Z',
      rank: 2,
      outcome: 'lost',
    },
  ],
  answer_total: 3,
  actions: [{ id: ACTION, title: 'Add the missing price', status: 'open' }],
};

const requested: string[] = [];

function serve(detail: Record<string, CommerceProductDetail>) {
  mswServer.use(
    http.get(`${base}/catalog`, () =>
      HttpResponse.json({
        products: [],
        product_total: 0,
        categories: [{ id: CATEGORY, name: 'Road', parent_id: null, product_count: 1 }],
        projection: { applicability: 'applicable', in_flight: 0, failed: 0 },
      }),
    ),
    http.get(`${base}/catalog/projection`, () =>
      HttpResponse.json({ applicability: 'applicable', in_flight: 0, failed: 0 }),
    ),
    http.get(`${base}/competitors`, () => HttpResponse.json([])),
    http.get(`${base}/competitors/discoveries`, () => HttpResponse.json([])),
    http.get(`${base}/buyer-prompts`, () => HttpResponse.json([])),
    http.get('/api/v1/prompt-sets', () => HttpResponse.json({ detail: 'n/a' }, { status: 404 })),
    http.get(`${base}/products/:holder`, ({ params, request }) => {
      requested.push(new URL(request.url).search);
      const found = detail[String(params.holder)];
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json(
            {
              error: {
                code: 'commerce_not_found',
                message: 'Product not found',
                request_id: 'req-1',
                retryable: false,
              },
            },
            { status: 404 },
          );
    }),
  );
}

/** The page at `path`; URL filters read the live address, so it is set there too. */
function renderAt(path: string, role: TestRole = 'owner') {
  window.history.replaceState(null, '', path);
  return renderWithProviders(
    <Routes>
      <Route path="/products/:targetId" element={<ProductDetailScreen />} />
    </Routes>,
    {
      projectSelection: { ...selectionAs(role), ...projectRoute.projectSelection },
      initialEntries: [path],
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  requested.length = 0;
});
afterAll(() => mswServer.close());

describe('ProductDetailScreen', () => {
  it('shows a catalog product’s metrics, the answers behind them and its setup', async () => {
    serve({ [ROAD]: ROAD_DETAIL });
    renderAt(`/products/${ROAD}?window=90`);

    expect(await screen.findByRole('heading', { name: 'Acme Road Runner' })).toBeInTheDocument();
    expect(requested).toEqual(['?window=90']);
    expect(screen.getByText('A daily trainer for road miles.')).toBeInTheDocument();
    const kpis = within(screen.getByRole('group', { name: 'Product metrics' }));
    expect(kpis.getByText('75.0%')).toBeInTheDocument();
    expect(kpis.getByText('$120.00')).toBeInTheDocument();
    // No ordered win, no quoted price: the missing mark, never zero.
    expect(kpis.getAllByText('Not measured')).toHaveLength(2);

    const rival = screen.getByRole('link', { name: 'Rival Pacer' });
    expect(new URL(rival.getAttribute('href')!, 'https://app.test').pathname).toBe(
      `/products/${RIVAL}`,
    );
    expect(screen.getByText(/ranked above it in 1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Best road shoes/ })).toHaveAttribute(
      'href',
      'https://reviews.example/best-road',
    );
    expect(
      screen.getByText('No search queries were captured for the answers that named it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The newest 1 of 3 answers that named it.')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();

    const setup = within(screen.getByRole('region', { name: 'Setup' }));
    expect(setup.getByRole('link', { name: 'Add the missing price' })).toBeInTheDocument();
    const agent = setup
      .getAllByRole('link', { name: 'Work with the agent' })
      .map((link) => new URL(link.getAttribute('href')!, 'https://app.test').searchParams);
    expect(agent.map((params) => params.get('action_id'))).toEqual([null, ACTION]);
    expect(agent[0]!.get('target_url')).toBe('https://shop.example/products/road');
    expect(setup.getByRole('button', { name: 'Find competitors' })).toBeInTheDocument();
  });

  it('shows a viewer the product and its setup without a control to change either', async () => {
    serve({ [ROAD]: ROAD_DETAIL });
    renderAt(`/products/${ROAD}`, 'viewer');

    expect(await screen.findByRole('heading', { name: 'Acme Road Runner' })).toBeInTheDocument();
    const setup = within(screen.getByRole('region', { name: 'Setup' }));
    expect(setup.getByRole('heading', { name: 'Competitors' })).toBeInTheDocument();
    for (const name of [
      'Find competitors',
      'Edit product',
      'Archive',
      'Review and launch',
      /^Generate/,
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByText('Add a prompt manually')).toBeNull();
  });

  it('reads the chosen window again when the reader changes it', async () => {
    serve({ [ROAD]: ROAD_DETAIL });
    renderAt(`/products/${ROAD}`);

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Acme Road Runner' });
    await chooseFilterOption(user, 'Window', 'Last 7 days');
    await waitFor(() => expect(requested).toEqual(['?window=30', '?window=7']));
  });

  it('gives a competitor its metrics without catalog setup', async () => {
    serve({
      [RIVAL]: {
        ...ROAD_DETAIL,
        product: {
          ...ROAD_DETAIL.product,
          holder_id: RIVAL,
          kind: 'approved_competitor',
          name: 'Rival Pacer',
          catalog: null,
        },
        actions: [],
      },
    });
    renderAt(`/products/${RIVAL}`);

    expect(await screen.findByRole('heading', { name: 'Rival Pacer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Competing products' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to tracking/ })).not.toBeInTheDocument();
  });

  it('saves only the edited fields of a catalog product', async () => {
    serve({ [ROAD]: ROAD_DETAIL });
    const sent: unknown[] = [];
    mswServer.use(
      http.patch(`${base}/products/:holder`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          id: ROAD,
          canonical_url: 'https://shop.example/products/road',
          name: 'Acme Road Runner 2',
          brand: 'Acme',
          category_ids: [],
        });
      }),
    );
    renderAt(`/products/${ROAD}`);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit product' }));
    const name = await screen.findByRole('textbox', { name: /Name/ });
    expect(name).toHaveValue('Acme Road Runner');
    await user.clear(name);
    await user.type(name, 'Acme Road Runner 2');
    const price = screen.getByRole('textbox', { name: 'Price' });
    await user.clear(price);
    await user.type(price, '99.5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(sent).toEqual([{ name: 'Acme Road Runner 2', price: 99.5 }]));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument(),
    );
  });

  it('keeps the record the drawer opened on when the page refetches under it', async () => {
    serve({ [ROAD]: ROAD_DETAIL });
    const sent: unknown[] = [];
    mswServer.use(
      http.patch(`${base}/products/:holder`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          id: ROAD,
          canonical_url: 'https://shop.example/products/road',
          name: 'Renamed elsewhere',
          brand: 'Acme',
          category_ids: [],
        });
      }),
    );
    const { queryClient } = renderAt(`/products/${ROAD}`);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit product' }));
    const price = await screen.findByRole('textbox', { name: 'Price' });
    await user.clear(price);
    await user.type(price, '99.5');
    // Someone renames the product; the page refetches while the drawer is open.
    let refetched = 0;
    mswServer.use(
      http.get(`${base}/products/:holder`, () => {
        refetched += 1;
        return HttpResponse.json({
          ...ROAD_DETAIL,
          product: { ...ROAD_DETAIL.product, name: 'Renamed elsewhere' },
        });
      }),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => expect(refetched).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(sent).toEqual([{ price: 99.5 }]));
  });

  it('shows an archived product as archived, without setup, and restores it', async () => {
    serve({
      [ROAD]: {
        ...ROAD_DETAIL,
        product: {
          ...ROAD_DETAIL.product,
          catalog: { ...ROAD_DETAIL.product.catalog!, lifecycle_state: 'archived' },
        },
      },
    });
    const sent: unknown[] = [];
    mswServer.use(
      http.put(`${base}/products/:holder/lifecycle`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          id: ROAD,
          canonical_url: 'https://shop.example/products/road',
          name: 'Acme Road Runner',
          brand: 'Acme',
          category_ids: [],
        });
      }),
    );
    renderAt(`/products/${ROAD}`);

    expect(await screen.findByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(sent).toEqual([{ lifecycle_state: 'active' }]));
  });

  it('adds a product the answers showed to tracking', async () => {
    serve({
      [RIVAL]: {
        ...ROAD_DETAIL,
        product: {
          ...ROAD_DETAIL.product,
          holder_id: RIVAL,
          kind: 'ai_observed_competitor',
          name: 'Rival Pacer',
          catalog: null,
        },
        actions: [],
      },
    });
    const sent: unknown[] = [];
    mswServer.use(
      http.patch(`${base}/competitors/:id`, async ({ params, request }) => {
        sent.push([params.id, await request.json()]);
        return HttpResponse.json({
          id: RIVAL,
          target_kind: 'product',
          target_id: ROAD,
          canonical_url: 'https://rival.example/pacer',
          product_name: 'Rival Pacer',
          brand_name: 'Rival',
          evidence: {},
          source_kind: 'ai_observed',
          state: 'approved',
          decision_at: '2026-11-11T00:00:00Z',
        });
      }),
    );
    renderAt(`/products/${RIVAL}`);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Add Rival Pacer to tracking' }));
    await waitFor(() => expect(sent).toEqual([[RIVAL, { decision: 'approved' }]]));
  });

  it('opens a category’s setup and reports an unknown product as not loaded', async () => {
    serve({});
    const category = renderAt(`/products/${CATEGORY}`);
    expect(await screen.findByRole('heading', { name: 'Road' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shopping prompts matrix' })).toBeInTheDocument();
    expect(requested).toEqual([]);
    category.unmount();

    renderAt(`/products/${RIVAL}`);
    expect(await screen.findByText('Product not found')).toBeInTheDocument();
  });
});
