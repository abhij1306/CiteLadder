import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import {
  COMPLETE_CLASSIFICATION_PROJECTION,
  EMPTY_WEB_FUNDAMENTALS,
  UNCHANGED_COHORT_COMPOSITION,
} from '@/test/site-health-fixtures';
import { makeSiteCrawl } from '@/test/fixtures/site-health';
import { ProjectProvider } from '@/lib/project/project-context';
import type { SiteHealthDashboard } from '@/lib/api/types';
import { SiteHealthScreen } from './site-health-screen';

function setSearch(value: string) {
  window.history.replaceState(null, '', value ? `/site?${value}` : '/site');
}

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '22222222-2222-4222-8222-222222222222';

const project = makeProject({ id: PROJECT, workspace_id: WORKSPACE });

/** A crawl that discovered its three pages but failed the analysis pass. */
function crawl(overrides: Record<string, unknown> = {}) {
  return makeSiteCrawl({
    id: CRAWL,
    workspace_id: WORKSPACE,
    project_id: PROJECT,
    status: 'failed',
    analysis_status: 'failed',
    analyzed_count: 0,
    analysis_requested_count: 0,
    counters: {
      discovered: 3,
      selected: 0,
      queued: 0,
      running: 0,
      analyzed: 0,
      errors: 0,
      blocked: 0,
      failure_breakdown: {
        robots_denied: 0,
        http_4xx: 0,
        http_5xx: 0,
        timeout: 0,
      },
      activity: {
        state: 'terminal',
        reason: 'terminal',
        queue_depth: 0,
        next_available_at: null,
      },
      by_page_kind: {},
    },
    ...overrides,
  });
}

function inventoryRow(id: string, url: string) {
  return {
    site_url_id: id,
    normalized_url: url,
    display_url: url,
    title: null,
    content_type: 'text/html',
    source: 'link',
    depth: 1,
    monitored: false,
    first_seen_at: null,
    last_seen_at: null,
    issue_count: null,
    web_fundamentals_score: null,
    web_fundamentals_coverage: null,
    web_fundamentals_state: 'not_measured',
    aeo_readiness_score: null,
    aeo_measurement_coverage: null,
    aeo_measurement_state: 'not_measured',
    aeo_measurement_reason: '',
    main_content_indexable: null,
    last_audited: null,
    page_kind: null,
  };
}

function overview(crawlId = CRAWL) {
  return {
    project_id: PROJECT,
    crawl_id: crawlId,
    snapshot_id: '77777777-7777-4777-8777-777777777777',
    search_eligibility: 'eligible',
    eligibility_totals: { eligible: 1, blocked: 0, unknown: 0, excluded: 0 },
    eligibility_reasons: [],
    web_fundamentals_score: 80,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 62,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    ...COMPLETE_CLASSIFICATION_PROJECTION,
    classified_page_count: 1,
    classification_expected_page_count: 1,
    scored_page_kind_set: ['homepage'],
    scored_page_count_by_kind: { homepage: 1 },
    crawl_coverage: {
      state: 'complete',
      evidence: { observed: 1, expected: 1 },
      denominator_kind: 'selected_intended_public_urls',
    },
    audited_page_count: 1,
    selected_page_count: 1,
    status_counts: { audited: 1, blocked: 0, error: 0, pending: 0 },
    issue_count: 0,
    technical_defect_count: 0,
    technical_defect_affected_page_count: 0,
    aeo_readiness_gap_count: 0,
    aeo_readiness_gap_affected_page_count: 0,
    severity_counts: {},
    category_counts: {},
    measured_check_count: 0,
    expected_check_count: 0,
    aeo_dimensions: [],
    top_issues: [],
    web_fundamentals: EMPTY_WEB_FUNDAMENTALS,
    trend: {
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
      metric: 'aeo_readiness_score',
      series: [],
      cohort_composition: UNCHANGED_COHORT_COMPOSITION,
    },
    change_summary: {
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
      metrics: [],
      cohort_composition: UNCHANGED_COHORT_COMPOSITION,
    },
  };
}

// Tests state the persisted server phase they render; backend tests own phase resolution.
function mockRoutes(
  crawlOverrides: Record<string, unknown> = {},
  phase: SiteHealthDashboard['phase'] = 'dashboard',
) {
  mswServer.use(
    http.get('/api/v1/projects', () => HttpResponse.json([project])),
    http.get('/api/v1/audits', () => HttpResponse.json([])),
    http.post('/api/v1/projects/:id/logos/refresh', () => HttpResponse.json(project)),
    http.post('/api/v1/site-crawls/:id/run', ({ params }) =>
      HttpResponse.json(crawl({ ...crawlOverrides, id: params.id })),
    ),
    http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
      HttpResponse.json({
        project_id: PROJECT,
        crawl: crawl(crawlOverrides),
        score_summary: null,
        phase,
        snapshot_id: null,
        quota: { used: 3, limit: 50 },
        root_errors: [],
      }),
    ),
    http.get(`/api/v1/projects/${PROJECT}/monitored-urls`, () =>
      HttpResponse.json({
        project_id: PROJECT,
        selection_version: 1,
        monitored_urls: [],
        quota: { used: 0, limit: 50 },
      }),
    ),
    http.get(`/api/v1/site-crawls/${CRAWL}/pages`, () =>
      HttpResponse.json({ items: [], next_cursor: null, root_errors: [] }),
    ),
    http.get(`/api/v1/site-crawls/${CRAWL}/inventory`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`/api/v1/site-crawls/${CRAWL}/events`, () => HttpResponse.text('', { status: 200 })),
    http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
      HttpResponse.json(overview()),
    ),
  );
}

function renderScreen() {
  return renderWithProviders(
    <ProjectProvider>
      <SiteHealthScreen />
    </ProjectProvider>,
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  setSearch('');
  mswServer.use(http.post('/api/v1/projects/:id/logos/refresh', () => HttpResponse.json(project)));
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

export {
  CRAWL,
  PROJECT,
  crawl,
  inventoryRow,
  mockRoutes,
  overview,
  project,
  renderScreen,
  setSearch,
};
