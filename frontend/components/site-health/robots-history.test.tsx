import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { SITE_HEALTH_SITE_FACTS } from '@/test/site-health-api-fixtures';
import { RobotsHistory } from './robots-history';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
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
  await user.click(await screen.findByRole('combobox', { name: 'Before robots.txt observation' }));
  await user.click((await screen.findAllByRole('option'))[2]!);
  await user.click(screen.getByRole('combobox', { name: 'After robots.txt observation' }));
  await user.click((await screen.findAllByRole('option'))[1]!);

  const diff = within(screen.getByRole('list', { name: 'robots.txt line diff' }));
  expect(diff.getAllByRole('listitem').map((line) => line.textContent)).toEqual([
    ' User-agent: *',
    '−Removed:Disallow: /',
    '+Added:Allow: /',
    ' # end',
  ]);
});
