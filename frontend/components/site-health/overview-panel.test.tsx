import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { figureText } from '@/test/figures';
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

function OverviewPanel(props: Omit<ComponentProps<typeof ScopedOverviewPanel>, 'workspaceId'>) {
  return <ScopedOverviewPanel workspaceId={WORKSPACE} {...props} />;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function stat(label: string) {
  const term = within(screen.getByTestId('overview-metrics')).getByText(label);
  return term.closest('[data-figure-cell]');
}

const terminalOverview = (overrides: Record<string, unknown> = {}) => ({
  project_id: PROJECT,
  crawl_id: CRAWL,
  snapshot_id: SNAPSHOT,
  ...COMPLETE_CLASSIFICATION_PROJECTION,
  search_eligibility: 'eligible',
  eligibility_totals: { eligible: 1, blocked: 0, unknown: 0, excluded: 0 },
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
      title: 'Missing page title',
      severity: 'critical',
      category: 'technical',
      section: 'technical',
      description: 'The page has a non-empty title.',
      remediation: 'Add a title.',
      score_roles: ['web_fundamentals'],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 4,
      impact_label: 'Critical',
    },
    {
      rule_id: 'aeo.visible_attribution',
      title: 'Visible creator attribution incomplete',
      severity: 'medium',
      category: 'content',
      section: 'content',
      description: 'The page names its author visibly.',
      remediation: 'Add a named author.',
      score_roles: ['aeo_readiness'],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 2,
      impact_label: 'Medium',
    },
    {
      rule_id: 'technical.meta_description_present',
      title: 'Missing meta description',
      severity: 'low',
      category: 'content',
      section: 'content',
      description: 'The page has a meta description.',
      remediation: 'Add a meta description.',
      score_roles: ['web_fundamentals'],
      affected_pages: 1,
      eligibility_blocker: false,
      impact_band: 1,
      impact_label: 'Low',
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
    limitations: ['HTTP evidence only; browser layout was not measured.'],
  },
  open_issue_trend: [{ day: '2026-08-30', open_count: 7 }],
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

    expect(figureText('Web fundamentals')).toBe('81');
    expect(figureText('AEO readiness')).toBe('62');
    expect(
      screen.queryByRole('heading', { name: 'Classification completeness' }),
    ).not.toBeInTheDocument();
    expect(figureText('AEO checklist completion')).toBe('50%');
    expect(figureText('Crawl coverage')).toBe('4 of 10 pages audited');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading Overview details')).not.toBeInTheDocument();
    expect(overviewRequests).toBe(0);
  });

  it('counts audited against found pages for a plan-limited crawl of a large site', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            crawl_coverage: {
              state: 'partial',
              evidence: {
                reasons: ['requested_page_limit_reached'],
                observation_count: 51306,
                analyzed_url_count: 199,
                failed_url_count: 2,
                automatic_limit: 200,
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

    await waitFor(() => expect(figureText('Crawl coverage')).toBe('199 of 51,306 pages audited'));
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

    await screen.findByRole('table', { name: 'Top issues' });
    expect(stat('Crawl coverage')).toHaveTextContent('Not measured');
    expect(screen.queryByRole('progressbar', { name: 'Crawl coverage' })).not.toBeInTheDocument();
  });

  it('links each score to where it is acted on', () => {
    renderWithProviders(
      <OverviewPanel
        projectId={PROJECT}
        crawlId={CRAWL}
        crawl={{ status: 'running', analyzed_count: 0, visible_url_count: 0 } as never}
        dashboard={undefined}
      />,
    );
    const links = within(screen.getByTestId('overview-metrics')).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Web fundamentals', '/issues?section=technical'],
      ['AEO readiness', '/issues?section=aeo'],
      ['AEO checklist completion', '/site?tab=aeo-readiness'],
      ['Crawl coverage', '/site?tab=pages'],
    ]);
  });

  it('plots open issues per day, oldest first', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            open_issue_trend: [
              { day: '2026-08-28', open_count: 12 },
              { day: '2026-08-30', open_count: 9 },
            ],
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

    const table = await screen.findByRole('table', { name: 'Open issues over time' });
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['Series2026-08-282026-08-30', 'Open issues129']);
    expect(screen.queryByRole('heading', { name: 'AEO readiness trend' })).not.toBeInTheDocument();
  });

  it('explains a changed scored cohort once, beside the score changes', async () => {
    const changedComposition = {
      added_page_kinds: ['product'],
      removed_page_kinds: [],
      previous_page_count_by_kind: { homepage: 1 },
      current_page_count_by_kind: { homepage: 1, product: 4 },
    };
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            change_summary: {
              state: 'measured',
              reason: 'cohort_composition_changed',
              metrics: [],
              cohort_composition: changedComposition,
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

    expect(await screen.findByRole('heading', { name: 'Score change' })).toBeVisible();
    expect(screen.getAllByText('Scored cohort composition changed.')).toHaveLength(1);
    expect(screen.getByText('Added page kinds: Product.')).toBeInTheDocument();
  });

  it('opens HTTP Web fundamentals evidence without browser-only checks', async () => {
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

    await screen.findByRole('table', { name: 'Top issues' });
    const areas = within(screen.getByRole('list', { name: 'Web fundamentals areas' }));
    expect(areas.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'accessibilityMeasured',
      'mobile1 of 4 checks run',
    ]);
    await user.click(screen.getByRole('button', { name: 'View evidence' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Images missing alt attributes');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('mobile_layout');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('HTTP evidence only');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Core Web Vitals');
  });

  it('names each top issue by its failing title under its severity', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(terminalOverview()),
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

    const table = await screen.findByRole('table', { name: 'Top issues' });
    expect(
      screen.getByRole('link', { name: 'Visible creator attribution incomplete' }),
    ).toHaveAttribute('href', '/issues?rule=aeo.visible_attribution&section=content');
    expect(screen.getByRole('link', { name: 'Missing page title' })).toHaveAttribute(
      'href',
      '/issues?rule=technical.title_present',
    );
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'ImpactIssuePages affected',
      'HighMissing page title1',
      'MediumVisible creator attribution incomplete1',
      'LowMissing meta description1',
    ]);
  });

  it('says a pillar with no applicable checks is not applicable, apart from one not measured', async () => {
    const pillar = (key: string, label: string, applicability: string) => ({
      key,
      label,
      description: `${label} checks.`,
      dimension_applicability: applicability,
      dimension_measurement_state: 'not_measured',
      score: null,
      coverage: null,
      earned_points: 0,
      determinate_points: 0,
      expected_points: 0,
      determinate_checkpoint_ids: [],
      unresolved_count: 0,
      reason: 'no_evidence',
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(
          terminalOverview({
            aeo_dimensions: [
              pillar('commerce', 'Commerce', 'not_applicable'),
              pillar('answerability', 'Answerability', 'applicable'),
            ],
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

    const table = await screen.findByRole('region', { name: 'AEO readiness by pillar' });
    const scoreOf = (label: string) =>
      within(within(table).getByText(label).closest('tr')!).getAllByRole('cell')[1]!.textContent;
    expect(scoreOf('Commerce')).toBe('—Not applicable');
    expect(scoreOf('Answerability')).toBe('—Not measured');
  });

  const ALERT = "Couldn't load the Site health overview";

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
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json({ error: { message: 'Forbidden' } }, { status: 403 }),
      ),
    );

    renderTerminal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Check your workspace access, then try again.');
    expect(alert).toHaveTextContent(ALERT);
  });
});
