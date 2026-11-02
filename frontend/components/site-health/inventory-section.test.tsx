import { delay, http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { makePageSummary, makeSiteCrawl, SITE_HEALTH_UUID_2 } from '@/test/fixtures/site-health';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { InventorySection } from './inventory-section';

const PAGES = `/api/v1/site-crawls/${SITE_HEALTH_UUID_2}/pages`;
const INVENTORY = `/api/v1/site-crawls/${SITE_HEALTH_UUID_2}/inventory`;
const LATER_PAGE = '33333333-3333-4333-8333-333333333333';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('InventorySection', () => {
  it('keeps the page browser’s rows and pager on screen while the next page loads', async () => {
    mswServer.use(
      http.get(PAGES, async ({ request }) => {
        const next = new URL(request.url).searchParams.has('cursor');
        if (next) await delay(300);
        return HttpResponse.json({
          items: [
            next
              ? makePageSummary({ site_url_id: LATER_PAGE, title: 'Pricing' })
              : makePageSummary({ title: 'Homepage' }),
          ],
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
    renderWithProviders(<InventorySection mode="scored" crawl={makeSiteCrawl()} active={false} />);
    expect(await screen.findByText('Homepage')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Errors & Blocked' }));

    expect(screen.getByText('Homepage')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pages' })).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('Broken page')).toBeInTheDocument();
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
});
