import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { invalidateCrawlViews, invalidateMonitoredProjection } from './invalidate';

const CRAWL = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

function seeded() {
  const client = new QueryClient();
  // A first page and a deep cursor page of the same list, plus another filter
  // combination — all three exist simultaneously in the real screen.
  client.setQueryData(queryKeys.siteHealth.pages(CRAWL, { cursor: null, monitored: true }), {
    items: [],
  });
  client.setQueryData(queryKeys.siteHealth.pages(CRAWL, { cursor: 'abc', monitored: true }), {
    items: [],
  });
  client.setQueryData(queryKeys.siteHealth.inventory(CRAWL, { cursor: null }), { items: [] });
  client.setQueryData(queryKeys.siteHealth.dashboard(PROJECT), { crawl: null });
  client.setQueryData(queryKeys.siteHealth.monitored(PROJECT), { monitored_urls: [] });
  return client;
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated ?? false;
}

describe('invalidateCrawlViews', () => {
  it('refreshes the first page of every crawl-derived list, across filters', () => {
    const client = seeded();

    invalidateCrawlViews(client, CRAWL);

    expect(
      invalidated(client, queryKeys.siteHealth.pages(CRAWL, { cursor: null, monitored: true })),
    ).toBe(true);
    expect(invalidated(client, queryKeys.siteHealth.inventory(CRAWL, { cursor: null }))).toBe(true);
  });

  it('leaves deeper cursor pages alone (the rows under review must not shift)', () => {
    const client = seeded();

    invalidateCrawlViews(client, CRAWL);

    expect(
      invalidated(client, queryKeys.siteHealth.pages(CRAWL, { cursor: 'abc', monitored: true })),
    ).toBe(false);
  });

  it('only touches the dashboard when a project is passed (it is the poll trigger)', () => {
    const polling = seeded();
    invalidateCrawlViews(polling, CRAWL);
    expect(invalidated(polling, queryKeys.siteHealth.dashboard(PROJECT))).toBe(false);

    const streaming = seeded();
    invalidateCrawlViews(streaming, CRAWL, PROJECT);
    expect(invalidated(streaming, queryKeys.siteHealth.dashboard(PROJECT))).toBe(true);
  });

  it('refreshes the project monitored projection without invalidating the dashboard', () => {
    const client = seeded();

    invalidateMonitoredProjection(client, PROJECT);

    expect(invalidated(client, queryKeys.siteHealth.monitored(PROJECT))).toBe(true);
    expect(invalidated(client, queryKeys.siteHealth.dashboard(PROJECT))).toBe(false);
  });
});
