import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
  SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { SearchIntelligencePage } from './search-intelligence-page';

const project = makeProject();
const root = `/api/v1/projects/${project.id}/search-intelligence`;
const run: SearchIntelligenceRun = {
  id: 'a5df36ea-cb35-40f9-a7a9-a50ff7309cf1',
  status: 'running',
  action: 'analysis',
  pricing_version: 'dataforseo-standard-2026-09-20',
  estimated_cost_usd: '0.14412',
  provider_reported_cost_usd: null,
  planned_calls: 4,
  completed_calls: 1,
  planned_rows: 400,
  received_rows: 100,
  uncertain_calls: 0,
  error_code: '',
  error_detail: '',
  expires_at: '2026-10-09T11:00:00Z',
  confirmed_at: '2026-10-09T10:00:00Z',
  cancelled_at: null,
  completed_at: null,
  frozen_scope: {},
  call_plan: [],
  reused_datasets: [],
  created_at: '2026-10-09T10:00:00Z',
};
const readiness: SearchIntelligenceReadiness = {
  connected: true,
  connection_id: '72dbc77c-676f-4bf7-8c29-16f163cb09f5',
  owned_targets: [
    {
      identity: 'primary',
      label: 'Example',
      registrable_domain: 'example.com',
      hostname: 'www.example.com',
      origin: 'https://www.example.com',
      source_kind: 'owned',
    },
  ],
  competitors: [],
  preferences: {
    owned_target_id: 'primary',
    competitor_ids: [],
    location_code: 2840,
    language_code: 'en',
    reuse_recent: true,
    depths: {},
  },
  latest_run: null,
  datasets: [],
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderPage(data: SearchIntelligenceReadiness) {
  mswServer.use(http.get(root, () => HttpResponse.json(data)));
  renderWithProviders(<SearchIntelligencePage />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
}

it('offers the first analysis from the empty overview', async () => {
  renderPage(readiness);
  expect(
    await screen.findByRole('heading', {
      name: 'See where you rank and where competitors outrank you',
    }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Review first analysis' })[0]!);
  expect(await screen.findByRole('dialog', { name: 'Review analysis cost' })).toBeInTheDocument();
});

/** A published dataset for one of the project's websites. */
function dataset(
  hostname: string,
  overrides: Partial<SearchIntelligenceDataset>,
): SearchIntelligenceDataset {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    run_id: run.id,
    dataset_kind: 'footprint',
    target_domain: hostname.replace(/^www\./u, ''),
    target_hostname: hostname,
    target_origin: `https://${hostname}`,
    research_scope: 'domain_subdomains',
    acquisition: {},
    comparison_origin: '',
    location_code: 2840,
    language_code: 'en',
    status: 'published',
    coverage: 'complete',
    requested_rows: 1,
    raw_rows_received: 1,
    unique_rows_saved: 0,
    provider_total: null,
    truncated: false,
    summary: {},
    collection_started_at: null,
    collection_ended_at: '2026-10-08T10:00:00Z',
    published_at: '2026-10-08T10:00:00Z',
    ...overrides,
  };
}

it('says when saved results can no longer be refreshed', async () => {
  renderPage({
    ...readiness,
    connected: false,
    connection_id: null,
    datasets: [dataset('www.example.com', { summary: { organic_keywords: 12 } })],
  });
  expect(
    await screen.findByText(/saved results can be read but not refreshed/),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open provider settings' })).toBeInTheDocument();
});

it('offers citation matching only for the website whose list is on screen', async () => {
  // Reads behind the tab's views are not under test; an empty error keeps them quiet.
  mswServer.use(http.get(`${root}/*`, () => HttpResponse.json({}, { status: 404 })));
  renderPage({
    ...readiness,
    datasets: [
      dataset('www.example.com', { dataset_kind: 'backlink_summary', unique_rows_saved: 1 }),
      dataset('blog.example.com', {
        id: '22222222-2222-4222-8222-222222222222',
        dataset_kind: 'referring_domains',
        unique_rows_saved: 40,
      }),
    ],
  });
  await userEvent.click(await screen.findByRole('tab', { name: 'Backlinks' }));
  expect(await screen.findByRole('combobox', { name: 'Saved target' })).toHaveTextContent(
    'www.example.com',
  );
  expect(
    screen.queryByRole('button', { name: 'Match with Visibility citations' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'Saved target' }));
  await userEvent.click(screen.getByRole('option', { name: 'blog.example.com' }));
  expect(
    await screen.findByRole('button', { name: 'Match with Visibility citations' }),
  ).toBeInTheDocument();
});

it('cancels an analysis in progress', async () => {
  let cancelled = false;
  mswServer.use(
    http.post(`${root}/runs/${run.id}/cancel`, () => {
      cancelled = true;
      return HttpResponse.json({ ...run, status: 'cancelled' });
    }),
  );
  renderPage({ ...readiness, latest_run: run });
  expect(await screen.findByText(/1 of 4 requests complete/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await expect.poll(() => cancelled).toBe(true);
});
