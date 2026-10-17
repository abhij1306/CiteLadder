import { expect, test } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const PROJECT = FIXTURE_PROJECT.id;
const SNAPSHOT = '99999999-9999-4999-8999-999999999999';
const emptyTotals = {
  clicks: null,
  impressions: null,
  ctr: null,
  position: null,
  sessions: null,
  key_events: null,
};
const emptySeries = { clicks: [], impressions: [], ctr: [], position: [] };
const emptyCounts = {
  query: 0,
  page: 0,
  country: 0,
  device: 0,
  search_appearance: 0,
  day: 0,
  bing_query: 0,
  bing_page: 0,
};

type DashboardMode = 'first-use' | 'zero' | 'bing';

const EVIDENCE_STATE: Record<DashboardMode, string> = {
  zero: 'observed_zero',
  bing: 'available',
  'first-use': 'not_run',
};

const PROVIDERS: Record<DashboardMode, string[]> = {
  bing: ['bing'],
  zero: ['gsc'],
  'first-use': [],
};

function performanceDashboard(mode: DashboardMode) {
  const measured = mode !== 'first-use';
  return {
    project_id: PROJECT,
    range: 'last_synced',
    granularity: 'day',
    compare: 'none',
    selected: {
      snapshot_id: measured ? SNAPSHOT : null,
      window_start: measured ? '2026-08-01' : '',
      window_end: measured ? '2026-08-28' : '',
      evidence_state: EVIDENCE_STATE[mode],
      totals: mode === 'zero' ? { ...emptyTotals, clicks: 0, impressions: 0 } : emptyTotals,
      series: emptySeries,
    },
    comparison: null,
    coverage: measured
      ? { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 }
      : { earliest_date: null, latest_date: null, covered_days: 0 },
    dimension_counts: mode === 'bing' ? { ...emptyCounts, bing_query: 1 } : emptyCounts,
    unavailable_dimensions: ['search_appearance'],
    formula_version: 'traffic-formula-1',
    normalization_version: 'traffic-normalization-1',
  };
}

test('Performance distinguishes first use, measured zero, and Bing-only evidence', async ({
  page,
}) => {
  let mode: DashboardMode = 'first-use';
  let tableReads = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuthedShell(page);
  await page.route(`**/api/v1/projects/${PROJECT}/performance?*`, (route) =>
    route.fulfill({ json: performanceDashboard(mode) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT}/readiness`, (route) =>
    route.fulfill({
      json: {
        project_id: PROJECT,
        stage: mode === 'first-use' ? 'not_connected' : 'analysis_ready',
        connection_count: mode === 'first-use' ? 0 : 1,
        providers: PROVIDERS[mode],
        backfill_state: null,
        imported_through: mode === 'first-use' ? null : '2026-08-28',
        has_performance_snapshot: mode !== 'first-use',
        has_demand_snapshot: false,
        opportunity_count: 0,
      },
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT}/performance/table?*`, (route) => {
    tableReads += 1;
    const dimension = new URL(route.request().url()).searchParams.get('dimension') ?? 'query';
    return route.fulfill({
      json: { dimension, items: [], next_cursor: null, total_count: 0, page_size: 25 },
    });
  });
  await page.route('**/api/v1/integrations', (route) => route.fulfill({ json: [] }));

  await page.goto(fixtureProjectPath('/performance'));
  await expect(page.getByText('No search performance evidence yet')).toBeVisible();
  await expect(page.getByTestId('metric-card-strip')).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Performance breakdowns' })).toHaveCount(0);
  expect(tableReads).toBe(0);

  mode = 'zero';
  await page.reload();
  await expect(page.getByTestId('metric-card-strip')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Performance breakdowns' })).toBeVisible();
  await expect.poll(() => tableReads).toBeGreaterThan(0);

  mode = 'bing';
  await page.reload();
  await expect(page.getByTestId('bing-panel')).toBeVisible();
  await expect(page.getByTestId('metric-card-strip')).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Performance breakdowns' })).toHaveCount(0);
});
