import { chooseFilterOption, openFilterRow } from '@/test/all-filters';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vite-plus/test';

import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
  SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import {
  renderWithProviders,
  selectionAs,
  testProjectSelection,
  type TestRole,
} from '@/test/render';
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
  markets: [{ country_code: 'US', location_code: 2840 }],
  max_depth: 1_000_000,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  window.history.replaceState(null, '', '/search-intelligence?tab=overview');
  mswServer.use(
    http.get(`/api/v1/projects/${project.id}/demand/latest`, () => new Promise(() => {})),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderPage(data: SearchIntelligenceReadiness, role: TestRole = 'owner') {
  mswServer.use(http.get(root, () => HttpResponse.json(data)));
  renderWithProviders(<SearchIntelligencePage />, {
    projectSelection: testProjectSelection({
      ...selectionAs(role),
      activeProject: project,
      activeProjectId: project.id,
    }),
  });
}

it('lets a viewer read an analysis in progress without offering to start or cancel one', async () => {
  renderPage({ ...readiness, latest_run: run }, 'viewer');
  expect(await screen.findByText(/1 of 4 requests complete/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cost details' })).toBeVisible();
  for (const name of ['Cancel', 'Review first analysis', 'New analysis', 'Refresh'])
    expect(screen.queryByRole('button', { name })).toBeNull();
});

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

it('tells a Member who may not add the login who can, without sending them to settings', async () => {
  renderPage(
    {
      ...readiness,
      connected: false,
      connection_id: null,
      datasets: [dataset('www.example.com', { summary: { organic_keywords: 12 } })],
    },
    'member',
  );
  expect(
    await screen.findByText(/A workspace Owner or Admin can add the login\./),
  ).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open provider settings' })).toBeNull();
});

it('offers citation matching only for the website whose list is on screen', async () => {
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
  await screen.findByRole('radiogroup', { name: 'backlinks view' });
  expect(await openFilterRow(userEvent.setup(), 'Website', 'www.example.com')).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(
    screen.getByText(
      (_, node) =>
        node?.parentElement?.tagName === 'OUTPUT' &&
        node.textContent === 'www.example.com · All referring countries · No saved analysis',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Match with Visibility citations' }),
  ).not.toBeInTheDocument();
  await chooseFilterOption(userEvent.setup(), 'Website', 'blog.example.com');
  expect(
    await screen.findByRole('button', { name: 'Match with Visibility citations' }),
  ).toBeInTheDocument();
});

it('moves between Demand and the research tabs on one tab row, keeping focus and the masthead', async () => {
  window.history.replaceState(null, '', '/search-intelligence');
  renderPage({
    ...readiness,
    datasets: [dataset('www.example.com', { summary: { organic_keywords: 12 } })],
  });
  const masthead = () => document.querySelector('header[data-masthead]') as HTMLElement;
  const actionNames = () =>
    within(masthead())
      .getAllByRole('button')
      .map((button) => button.textContent);
  const demand = await screen.findByRole('tab', { name: 'Demand' });
  await within(masthead()).findByRole('button', { name: 'New analysis' });
  const onDemand = actionNames();
  expect(onDemand).toEqual(expect.arrayContaining(['Cost details', 'Refresh', 'New analysis']));
  demand.focus();
  await userEvent.keyboard('{ArrowRight}');
  const overview = screen.getByRole('tab', { name: 'Overview' });
  expect(overview).toHaveFocus();
  expect(overview).toHaveAttribute('aria-selected', 'true');
  expect(actionNames()).toEqual(onDemand);
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Demand' })).toHaveFocus();
  expect(actionNames()).toEqual(onDemand);
});

it('keeps the tab row when Keyword Research cannot be read', async () => {
  mswServer.use(
    http.get(root, () =>
      HttpResponse.json({ error: { code: 'invalid', message: 'Read failed' } }, { status: 422 }),
    ),
  );
  renderWithProviders(<SearchIntelligencePage />, {
    projectSelection: testProjectSelection({ activeProject: project, activeProjectId: project.id }),
  });
  expect(await screen.findByText('Read failed')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Keywords' })).toBeInTheDocument();
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

it('offers a stopped analysis its recovery: review and run it again', async () => {
  renderPage({
    ...readiness,
    latest_run: { ...run, status: 'failed', error_code: 'acquisition_queue_terminal' },
  });
  expect(
    await screen.findByText(/The analysis stopped before every request finished\./),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Review again' }));
  expect(await screen.findByRole('dialog', { name: 'Review analysis cost' })).toBeInTheDocument();
});
