import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { SearchIntelligenceHistory } from './search-intelligence-history';

const project = makeProject();
const dataset: SearchIntelligenceDataset = {
  id: 'b6df36ea-cb35-40f9-a7a9-a50ff7309cf2',
  run_id: '72dbc77c-676f-4bf7-8c29-16f163cb09f5',
  dataset_kind: 'backlink_history',
  target_domain: 'example.com',
  target_hostname: 'example.com',
  target_origin: 'https://example.com',
  research_scope: 'exact_host',
  acquisition: {},
  comparison_origin: '',
  location_code: 2840,
  language_code: 'en',
  status: 'published',
  coverage: 'complete',
  requested_rows: 3,
  raw_rows_received: 3,
  unique_rows_saved: 3,
  provider_total: 3,
  truncated: false,
  summary: {},
  collection_started_at: null,
  collection_ended_at: null,
  published_at: null,
};

function month(id: string, date: string, backlinks: number, changes: Record<string, unknown>) {
  return {
    id,
    dataset_id: dataset.id,
    call_id: null,
    row_kind: 'backlink_history',
    keyword: '',
    domain: 'example.com',
    url: '',
    search_volume: null,
    difficulty: null,
    intent: '',
    rank_group: null,
    owned_rank_group: null,
    etv: null,
    backlinks,
    referring_main_domains: null,
    dataforseo_rank: null,
    auxiliary: { date, ...changes },
  };
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => row.textContent);

it('charts monthly totals and changes, leaving an unobserved month as a gap', async () => {
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({
        dataset,
        rows: [
          // Saved out of order, with June never observed.
          month('33333333-3333-4333-8333-333333333333', '2026-07-01', 1400, {
            new_backlinks: 90,
            lost_backlinks: 30,
          }),
          month('11111111-1111-4111-8111-111111111111', '2026-05-01', 1240, {
            new_backlinks: 120,
            lost_backlinks: 'unknown',
          }),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<SearchIntelligenceHistory dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });

  expect(
    await screen.findByRole('table', { name: 'Saved monthly backlink totals' }),
  ).toBeInTheDocument();
  expect(rows('Saved monthly backlink totals')).toEqual([
    'SeriesMay 2026Jun 2026Jul 2026',
    'Backlinks1,240Not measured1,400',
  ]);
  expect(rows('Saved monthly new and lost backlinks')).toEqual([
    'SeriesMay 2026Jun 2026Jul 2026',
    'New backlinks120Not measured90',
    'Lost backlinksNot measuredNot measured30',
  ]);
});

it('asks for a second observation before drawing a trend', async () => {
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/search-intelligence/datasets/${dataset.id}/rows`, () =>
      HttpResponse.json({
        dataset,
        rows: [month('11111111-1111-4111-8111-111111111111', '2026-05-01', 1240, {})],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<SearchIntelligenceHistory dataset={dataset} />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });

  expect(
    await screen.findByText('History needs at least two saved observations to show a trend.'),
  ).toBeVisible();
  expect(screen.queryByRole('table')).toBeNull();
});
