import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vite-plus/test';
import { renderWithProviders } from '@/test/render';
import { TrafficPages } from './pages-view';

it('keeps inventory, zero, partial values and distinct unavailable reasons readable', async () => {
  const user = userEvent.setup();
  const unavailable = {
    state: 'not_connected' as const,
    value: null,
    coverage: null,
    reason: null,
  };
  renderWithProviders(
    <TrafficPages
      data={{
        window_start: '2026-01-01',
        window_end: '2026-01-28',
        next_cursor: null,
        observed_crawl_coverage: {
          label: 'Observed crawl coverage',
          state: 'unknown',
          share: null,
          known_pages: 200,
          observed_pages: null,
          inventory_date: null,
          inventory_complete: false,
          sample_mode: false,
        },
        items: [
          {
            url_hash: 'page',
            canonical_url: 'https://example.test/long-page',
            display_path: '/long-page',
            folder: '/',
            resource_class: 'html',
            crawl: unavailable,
            referrals: { state: 'zero', value: 0, coverage: 'complete', reason: null },
            citations: { state: 'value', value: 12, coverage: 'partial', reason: 'limited_window' },
            findings: { state: 'value', value: 1, coverage: null, reason: null },
            key_events: 0,
            last_crawl: null,
            errors_4xx: null,
            errors_5xx: null,
          },
          {
            url_hash: 'second',
            canonical_url: 'https://example.test/second',
            display_path: '/second',
            folder: '/',
            resource_class: 'html',
            crawl: { state: 'unknown', value: null, coverage: 'partial', reason: 'missing_days' },
            referrals: unavailable,
            citations: unavailable,
            findings: unavailable,
            key_events: null,
            last_crawl: null,
            errors_4xx: 0,
            errors_5xx: null,
          },
        ],
      }}
    />,
  );
  const row = screen.getByRole('row', { name: /long-page/ });
  expect(within(row).getAllByRole('cell', { name: '0' })).toHaveLength(2);
  expect(within(row).getByRole('cell', { name: '1' })).toBeVisible();
  const partial = within(row).getByRole('button', {
    name: '12 citations',
  });
  expect(partial).toHaveTextContent('12Partial');
  const missing = within(row).getByRole('button', { name: 'Unavailable requests' });
  expect(missing).toHaveTextContent('–');
  act(() => missing.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('requests: Not connected');
  await user.keyboard('{Escape}');
  expect(within(row).getByRole('button', { name: /4xx and 5xx unavailable/ })).toHaveTextContent(
    '–',
  );
  const second = screen.getByRole('row', { name: /\/second/ });
  expect(
    within(second).getByRole('button', { name: '5xx unavailable' }).closest('td'),
  ).toHaveTextContent('0 / –');
  expect(screen.getByText(/Crawl coverage unavailable · 200 known pages/)).toBeVisible();
});
