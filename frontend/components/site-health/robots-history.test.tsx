import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import { openFilterOptions } from '@/test/all-filters';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { SITE_HEALTH_SITE_FACTS } from '@/test/site-health-api-fixtures';
import { RobotsHistory } from './robots-history';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';

/** Picks the observation at `index` in one side's options (0 is the placeholder). */
async function pickObservation(
  user: ReturnType<typeof userEvent.setup>,
  side: 'Before' | 'After',
  index: number,
) {
  await openFilterOptions(user, side);
  (await screen.findAllByRole('menuitemradio'))[index]!.focus();
  await user.keyboard('{Enter}');
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const item = (crawlId: string, observedAt: string) => ({
  crawl_id: crawlId,
  robots: {
    ...SITE_HEALTH_SITE_FACTS.robots,
    observed_at: observedAt,
    robots_snapshot_id: crawlId,
  },
});
const snapshot = (id: string, body: string) => ({
  id,
  origin: 'https://example.com',
  content_hash: id,
  body,
  truncated: false,
  status_code: 200,
});

it('keeps the observations and the pager on screen while the next page loads', async () => {
  let releaseOlder!: () => void;
  const olderHeld = new Promise<void>((resolve) => {
    releaseOlder = resolve;
  });
  const asked: string[] = [];
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/site-health/robots-history`, async ({ request }) => {
      const params = new URL(request.url).searchParams;
      asked.push(`${params.get('cursor') ?? 'first'}:${params.get('limit')}`);
      if (params.get('cursor') !== 'older')
        return HttpResponse.json({
          items: [item(NEW, '2026-10-02T00:00:00Z')],
          snapshots: [snapshot(NEW, 'User-agent: *')],
          next_cursor: 'older',
        });
      await olderHeld;
      return HttpResponse.json({
        items: [item(OLD, '2026-10-01T00:00:00Z')],
        snapshots: [snapshot(OLD, 'User-agent: *\nDisallow: /')],
        next_cursor: null,
      });
    }),
  );
  const user = userEvent.setup();
  renderWithProviders(<RobotsHistory workspaceId={WORKSPACE} projectId={PROJECT} />);
  const table = await screen.findByRole('table', { name: 'robots.txt observation sequence' });
  expect(await within(table).findByRole('cell', { name: '13 characters' })).toBeVisible();
  // A snapshot is named by what it holds, never by its stored ID.
  expect(table).not.toHaveTextContent(NEW);

  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(asked).toEqual(['first:5', 'older:5']));
  expect(within(table).getByRole('cell', { name: '13 characters' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

  releaseOlder();
  expect(await within(table).findByRole('cell', { name: '25 characters' })).toBeVisible();
  expect(within(table).queryByRole('cell', { name: '13 characters' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
});

it('diffs two observations line by line across line-ending styles', async () => {
  const user = userEvent.setup();
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/site-health/robots-history`, () =>
      HttpResponse.json({
        items: [item(NEW, '2026-10-02T00:00:00Z'), item(OLD, '2026-10-01T00:00:00Z')],
        snapshots: [
          snapshot(OLD, 'User-agent: *\r\nDisallow: /\r\n# end'),
          snapshot(NEW, 'User-agent: *\nAllow: /\n# end'),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<RobotsHistory workspaceId={WORKSPACE} projectId={PROJECT} />);

  // Options list the placeholder, then observations newest first.
  await screen.findByRole('button', { name: 'All filters' });
  await pickObservation(user, 'Before', 2);
  await pickObservation(user, 'After', 1);

  const diff = within(screen.getByRole('list', { name: 'robots.txt line diff' }));
  expect(diff.getAllByRole('listitem').map((line) => line.textContent)).toEqual([
    ' User-agent: *',
    '−Removed:Disallow: /',
    '+Added:Allow: /',
    ' # end',
  ]);

  // The same observation on both sides has nothing to compare.
  await pickObservation(user, 'Before', 1);
  expect(screen.queryByRole('list', { name: 'robots.txt line diff' })).not.toBeInTheDocument();
});

it('counts a one-character body in the singular', async () => {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/site-health/robots-history`, () =>
      HttpResponse.json({
        items: [item(NEW, '2026-10-02T00:00:00Z')],
        snapshots: [snapshot(NEW, '#')],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<RobotsHistory workspaceId={WORKSPACE} projectId={PROJECT} />);
  expect(await screen.findByRole('cell', { name: '1 character' })).toBeVisible();
});
