import { delay, http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { makePageSummary, makeSiteCrawl, SITE_HEALTH_UUID_2 } from '@/test/fixtures/site-health';
import { mswServer } from '@/test/msw-server';
import { chooseFilterOption } from '@/test/all-filters';
import { renderWithProviders } from '@/test/render';
import { InventorySection } from './inventory-section';

function PagesBrowser() {
  return <InventorySection mode="scored" crawl={makeSiteCrawl()} active={false} />;
}

const PAGES = `/api/v1/site-crawls/${SITE_HEALTH_UUID_2}/pages`;
const INVENTORY = `/api/v1/site-crawls/${SITE_HEALTH_UUID_2}/inventory`;
const LATER_PAGE = '33333333-3333-4333-8333-333333333333';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('InventorySection', () => {
  it('keeps the page browser’s rows and pager on screen while the next page loads', async () => {
    const firstPage = [
      makePageSummary({ title: 'Homepage' }),
      ...Array.from({ length: 9 }, (_, index) =>
        makePageSummary({
          site_url_id: `44444444-4444-4444-8444-44444444444${index}`,
          title: `Article ${index + 1}`,
        }),
      ),
    ];
    mswServer.use(
      http.get(PAGES, async ({ request }) => {
        const next = new URL(request.url).searchParams.has('cursor');
        if (next) await delay(300);
        return HttpResponse.json({
          items: next
            ? [makePageSummary({ site_url_id: LATER_PAGE, title: 'Pricing' })]
            : firstPage,
          next_cursor: next ? null : 'page-2',
          root_errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InventorySection mode="scored" crawl={makeSiteCrawl()} active={false} />);

    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    const table = screen.getByRole('region', { name: 'Pages' });
    expect(within(table).getByText('Homepage')).toBeInTheDocument();
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(within(table).getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(await within(table).findByText('Pricing')).toBeInTheDocument();
    expect(within(table).queryByText('Homepage')).not.toBeInTheDocument();
  });

  it('keeps the current tab’s rows on screen while another tab’s first page loads', async () => {
    mswServer.use(
      http.get(PAGES, async ({ request }) => {
        const errors = new URL(request.url).searchParams.get('status') === 'error_or_blocked';
        if (errors) await delay(300);
        return HttpResponse.json({
          items: [
            errors
              ? makePageSummary({ site_url_id: LATER_PAGE, title: 'Broken page' })
              : makePageSummary({ title: 'Homepage' }),
          ],
          next_cursor: null,
          root_errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PagesBrowser />);
    expect(await screen.findByText('Homepage')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Errors' }));

    expect(screen.getByText('Homepage')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pages' })).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('Broken page')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Errors' })).toHaveAttribute('aria-checked', 'true');
  });

  it('asks the server for the page kind picked in the table toolbar', async () => {
    const requested: Array<string | null> = [];
    mswServer.use(
      http.get(PAGES, ({ request }) => {
        const pageKind = new URL(request.url).searchParams.get('page_kind');
        requested.push(pageKind);
        return HttpResponse.json({
          items: [makePageSummary({ title: pageKind === 'faq' ? 'FAQ page' : 'Homepage' })],
          next_cursor: null,
          root_errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PagesBrowser />);
    expect(await screen.findByText('Homepage')).toBeInTheDocument();

    expect(requested.at(-1)).toBeNull();
    await chooseFilterOption(user, 'Page kind', 'FAQ');

    expect(await screen.findByText('FAQ page')).toBeInTheDocument();
    expect(requested.at(-1)).toBe('faq');
    expect(window.location.search).toBe('?page_kind=faq');
  });

  it('searches the pages by URL on the server, and says when none match', async () => {
    window.history.replaceState(null, '', '/site');
    const requested: Array<string | null> = [];
    mswServer.use(
      http.get(PAGES, ({ request }) => {
        const query = new URL(request.url).searchParams.get('query');
        requested.push(query);
        return HttpResponse.json({
          items:
            query === 'nothing' ? [] : [makePageSummary({ title: query ? 'Bags' : 'Homepage' })],
          next_cursor: null,
          root_errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PagesBrowser />);
    expect(await screen.findByText('Homepage')).toBeInTheDocument();
    expect(requested.at(-1)).toBeNull();

    const search = () => screen.getByRole('searchbox', { name: 'Search pages' });
    await user.type(search(), '/bags{Enter}');
    expect(await screen.findByText('Bags')).toBeInTheDocument();
    expect(requested.at(-1)).toBe('/bags');
    expect(new URLSearchParams(window.location.search).get('pages_query')).toBe('/bags');

    await user.clear(search());
    await user.type(search(), 'nothing{Enter}');
    expect(
      await screen.findByRole('heading', { name: 'No pages match “nothing”' }),
    ).toBeInTheDocument();
  });

  it('lists every page again once the search box is emptied, without Enter', async () => {
    window.history.replaceState(null, '', '/site');
    mswServer.use(
      http.get(PAGES, ({ request }) => {
        const query = new URL(request.url).searchParams.get('query');
        return HttpResponse.json({
          items: [makePageSummary({ title: query ? 'Bags' : 'Homepage' })],
          next_cursor: null,
          root_errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PagesBrowser />);
    const search = () => screen.getByRole('searchbox', { name: 'Search pages' });
    await user.type(await screen.findByRole('searchbox', { name: 'Search pages' }), '/bags{Enter}');
    expect(await screen.findByText('Bags')).toBeInTheDocument();

    await user.clear(search());

    expect(await screen.findByText('Homepage')).toBeInTheDocument();
    expect(screen.queryByText('Bags')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('pages_query')).toBeNull();
  });

  it('draws the discovered pages’ first load inside their table', async () => {
    mswServer.use(
      http.get(INVENTORY, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(
      <InventorySection
        mode="discovering"
        crawl={makeSiteCrawl({ status: 'running', discovery_status: 'running' })}
        active
      />,
    );

    const table = screen.getByRole('region', { name: 'Pages discovered so far' });
    expect(within(table).getByRole('columnheader', { name: 'Page URL' })).toBeVisible();
    expect(
      await within(table).findByRole('status', { name: 'Loading discovered pages…' }),
    ).toBeInTheDocument();
  });

  it('prints discovered URLs without the origin they all share', async () => {
    const discovered = (site_url_id: string, display_url: string) => ({
      ...makePageSummary({ site_url_id, display_url, normalized_url: display_url }),
      content_type: 'text/html',
      source: 'sitemap',
      depth: 1,
      first_seen_at: null,
      last_seen_at: null,
    });
    mswServer.use(
      http.get(INVENTORY, () =>
        HttpResponse.json({
          items: [
            discovered(LATER_PAGE, 'https://acme.com/journal/teapots'),
            discovered(SITE_HEALTH_UUID_2, 'https://acme.com/'),
          ],
          next_cursor: null,
        }),
      ),
    );
    renderWithProviders(
      <InventorySection
        mode="discovering"
        crawl={makeSiteCrawl({ status: 'running', discovery_status: 'running' })}
        active
      />,
    );

    const table = screen.getByRole('region', { name: 'Pages discovered so far' });
    await within(table).findByRole('cell', { name: '/journal/teapots' });
    const firstCells = within(table)
      .getAllByRole('row')
      .slice(1, 3)
      .map((row) => within(row).getAllByRole('cell')[0]!.textContent);
    expect(firstCells).toEqual(['/journal/teapots', '/']);
  });
});
