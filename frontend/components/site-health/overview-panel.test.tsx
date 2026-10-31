import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import {
  COMPLETE_CLASSIFICATION_PROJECTION,
  UNCHANGED_COHORT_COMPOSITION,
} from '@/test/site-health-fixtures';
import type { ComponentProps } from 'react';
import { OverviewPanel as ScopedOverviewPanel } from './overview-panel';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT = '33333333-3333-4333-8333-333333333333';
const SOURCE = '44444444-4444-4444-8444-444444444444';

function OverviewPanel(props: Omit<ComponentProps<typeof ScopedOverviewPanel>, 'workspaceId'>) {
  return <ScopedOverviewPanel workspaceId={WORKSPACE} {...props} />;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

/** A terminal overview snapshot; each test overrides only what it is about. */
const terminalOverview = (overrides: Record<string, unknown> = {}) => ({
  project_id: PROJECT,
  crawl_id: CRAWL,
  snapshot_id: SNAPSHOT,
  ...COMPLETE_CLASSIFICATION_PROJECTION,
  search_eligibility: 'eligible',
  eligibility_totals: { eligible: 1, blocked: 0, unknown: 0, excluded: 0 },
  eligibility_reasons: [],
  web_fundamentals_score: 88,
  web_fundamentals_coverage: 1,
  web_fundamentals_state: 'measured',
  aeo_readiness_score: 72,
  aeo_measurement_coverage: 0.6,
  aeo_measurement_state: 'limited_evidence',
  crawl_coverage: {
    state: 'partial',
    evidence: { reasons: ['requested_page_limit_reached'] },
    denominator_kind: 'selected_intended_public_urls',
  },
  audited_page_count: 1,
  selected_page_count: 1,
  status_counts: { audited: 1 },
  issue_count: 2,
  technical_defect_count: 1,
  technical_defect_affected_page_count: 1,
  aeo_readiness_gap_count: 1,
  aeo_readiness_gap_affected_page_count: 1,
  severity_counts: { medium: 2 },
  category_counts: { content: 2 },
  measured_check_count: 6,
  expected_check_count: 10,
  aeo_dimensions: [],
  top_issues: [
    {
      rule_id: 'technical.title_present',
      finding_class: 'defect',
      severity: 'critical',
      category: 'technical',
      description: 'Title is missing',
      remediation: 'Add a title.',
      score_roles: ['web_fundamentals'],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 4,
      impact_label: 'Critical',
    },
    {
      rule_id: 'aeo.visible_attribution',
      finding_class: 'advisory',
      severity: 'medium',
      category: 'content',
      description: 'Author attribution is missing',
      remediation: 'Add a named author.',
      score_roles: ['aeo_readiness'],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 2,
      impact_label: 'Authority · 10%',
    },
    {
      rule_id: 'technical.meta_description_present',
      finding_class: 'advisory',
      severity: 'info',
      category: 'content',
      description: 'Meta description is missing',
      remediation: 'Add a meta description.',
      score_roles: [],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 0,
      impact_label: 'Advisory',
    },
  ],
  web_fundamentals: {
    state: 'limited_evidence',
    areas: [
      {
        key: 'accessibility',
        state: 'measured',
        coverage: 1,
        passed_count: 3,
        missing_count: 1,
        unknown_count: 0,
        unavailable_count: 0,
        unavailable_checks: [],
        top_findings: [
          {
            rule_id: 'web.accessibility_image_alt',
            title: 'Images missing alt attributes',
            remediation: 'Add alt text to informative images.',
            affected_pages: 1,
            source_evaluation_ids: [SOURCE],
          },
        ],
      },
      {
        key: 'mobile',
        state: 'limited_evidence',
        coverage: 0.25,
        passed_count: 1,
        missing_count: 0,
        unknown_count: 0,
        unavailable_count: 3,
        unavailable_checks: ['mobile_layout', 'touch_targets', 'runtime_overflow'],
        top_findings: [],
      },
    ],
    field_data: {
      state: 'unavailable',
      reason: 'provider_not_configured',
      lcp: null,
      inp: null,
      cls: null,
    },
    source_analysis_ids: [SOURCE],
    source_artifact_ids: [SOURCE],
    source_evaluation_ids: [SOURCE],
    limitations: ['HTTP evidence only; browser layout was not measured.'],
  },
  trend: {
    state: 'unavailable',
    reason: 'no_comparable_snapshot',
    metric: 'aeo_readiness_score',
    series: [{ label: '2026-08-30', value: 72 }],
    cohort_composition: UNCHANGED_COHORT_COMPOSITION,
  },
  change_summary: {
    state: 'unavailable',
    reason: 'no_comparable_snapshot',
    metrics: [],
    cohort_composition: UNCHANGED_COHORT_COMPOSITION,
  },
  ...overrides,
});

describe('OverviewPanel', () => {
  it('uses the live dashboard while active without fetching a terminal snapshot', async () => {
    let overviewRequests = 0;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () => {
        overviewRequests += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'running', analyzed_count: 4, visible_url_count: 10 } as never}
        dashboard={
          {
            score_summary: {
              ...COMPLETE_CLASSIFICATION_PROJECTION,
              classification_state: 'partial',
              classification_coverage: 0.5,
              classified_page_count: 2,
              other_page_count: 1,
              classification_expected_page_count: 4,
              web_fundamentals_score: 81,
              web_fundamentals_coverage: 0.75,
              web_fundamentals_state: 'limited_evidence',
              aeo_readiness_score: 62,
              aeo_measurement_coverage: 0.5,
              aeo_measurement_state: 'limited_evidence',
              analyzed_count: 4,
              selected_count: 10,
              issue_count: 3,
            },
          } as never
        }
      />,
    );

    expect(screen.getByRole('img', { name: 'Web Fundamentals score: 81' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Checklist Completion: 50%' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Readiness score: 62' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Classification completeness' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Crawl Coverage score: 40' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading Overview details')).not.toBeInTheDocument();
    expect(overviewRequests).toBe(0);
  });

  it('says how many found pages were analyzed and why the rest were not', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            crawl_coverage: {
              state: 'partial',
              evidence: {
                reasons: ['requested_page_limit_reached'],
                observation_count: 100,
                analyzed_url_count: 20,
                failed_url_count: 2,
                automatic_limit: 20,
              },
              denominator_kind: 'selected_intended_public_urls',
            },
          }),
        ),
      ),
    );
    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'completed' } as never}
        dashboard={undefined}
      />,
    );

    // 20 analyzed of 100 found is 20% coverage, not 100% of the 20 selected.
    expect(
      await screen.findByRole('img', { name: 'Crawl Coverage score: 20' }),
    ).toBeInTheDocument();
  });

  it('keeps an unknown crawl that found nothing from reading as a percentage', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            crawl_coverage: {
              state: 'unknown',
              evidence: {
                reasons: ['discovery_failed', 'no_observed_urls'],
                observation_count: 0,
                analyzed_url_count: 0,
                failed_url_count: 0,
                automatic_limit: null,
              },
              denominator_kind: 'selected_intended_public_urls',
            },
          }),
        ),
      ),
    );
    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'completed', analyzed_count: 4, visible_url_count: 4 } as never}
        dashboard={undefined}
      />,
    );

    expect(await screen.findByRole('img', { name: /Web Fundamentals score/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Crawl Coverage score/ })).not.toBeInTheDocument();
  });

  it('opens persisted HTTP Web Fundamentals evidence without browser-only checks', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(terminalOverview()),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'completed' } as never}
        dashboard={undefined}
      />,
    );

    const issueLink = await screen.findByRole('link', { name: 'Author attribution is missing' });
    expect(issueLink).toHaveAttribute(
      'href',
      '/issues?rule=aeo.visible_attribution&finding_class=advisory',
    );
    await user.click(screen.getByRole('button', { name: 'View evidence' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Images missing alt attributes');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('mobile_layout');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('HTTP evidence only');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Core Web Vitals');
  });

  const ALERT = 'Could not load the persisted Site Health Overview.';

  function renderTerminal() {
    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'completed', analyzed_count: 4, visible_url_count: 4 } as never}
        dashboard={undefined}
      />,
    );
  }

  it('stays silent when the snapshot simply does not exist yet', async () => {
    // Terminalization WRITES the snapshot, so 404 is this endpoint saying
    // "not yet", not "something went wrong". It was reported as a red alert
    // over a healthy run, because hovering the Overview tab warmed this key
    // mid-crawl and the cached error outlived the disabled query.
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          { error: { message: 'Site Health Overview is not available' } },
          { status: 404 },
        ),
      ),
    );

    renderTerminal();

    expect(await screen.findByTestId('site-health-overview')).toBeInTheDocument();
    expect(screen.queryByText(ALERT)).not.toBeInTheDocument();
  });

  it('still reports a snapshot read that genuinely failed', async () => {
    // 403, not 500: the real retry policy applies in these tests, and a
    // retried 5xx outlives the assertion's window rather than the condition.
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json({ error: { message: 'Forbidden' } }, { status: 403 }),
      ),
    );

    renderTerminal();

    // The shared read error names the failure and, for 403, the one recovery.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check your workspace access, then try again.',
    );
  });
});
