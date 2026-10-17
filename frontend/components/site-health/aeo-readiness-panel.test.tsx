import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { AeoReadinessPanel as ScopedAeoReadinessPanel } from './aeo-readiness-panel';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '22222222-2222-4222-8222-222222222222';
const ANALYSIS = '33333333-3333-4333-8333-333333333333';
const PAGE_A = '44444444-4444-4444-8444-444444444444';
const PAGE_B = '55555555-5555-4555-8555-555555555555';

const DIMENSIONS = [
  ['answerability', 'Answerability'],
  ['structure', 'Structure'],
  ['evidence', 'Evidence'],
  ['machine-readability', 'Machine readability'],
  ['provenance', 'Provenance'],
  ['freshness', 'Freshness'],
  ['crawlability', 'Crawlability'],
] as const;

function AeoReadinessPanel(props: Readonly<{ projectId: string; crawlId: string }>) {
  return <ScopedAeoReadinessPanel workspaceId={WORKSPACE} {...props} />;
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function dimension(key: string, label: string, failing: boolean) {
  const ruleId = `rule.${key}.0`;
  return {
    key,
    label,
    description: `What ${label.toLowerCase()} means in one sentence.`,
    dimension_applicability: 'applicable',
    dimension_measurement_state: 'measured',
    score: failing ? 60 : 100,
    reason: '',
    checkpoint_ids: [ruleId],
    determinate_checkpoint_ids: [ruleId],
    unresolved_count: 0,
    earned_points: failing ? 3 : 5,
    determinate_points: 5,
    expected_points: 6,
    satisfied_count: failing ? 3 : 4,
    partial_count: 0,
    missing_count: failing ? 2 : 0,
    unknown_count: 0,
    not_applicable_count: 1,
    error_count: 0,
    coverage: 0.8333,
    checked_page_count: 5,
    failing_page_count: failing ? 2 : 0,
    checks: [
      {
        rule_id: ruleId,
        scope: 'page',
        title: failing ? 'Answer is not stated first' : 'Headings are unique',
        remediation: 'Move the direct answer into the first paragraph.',
        satisfied_count: failing ? 3 : 4,
        partial_count: 0,
        missing_count: failing ? 2 : 0,
        unknown_count: 0,
        not_applicable_count: 1,
        error_count: 0,
        failing_entity_count: failing ? 2 : 0,
        aeo_pillar: key,
        content_addressable: true,
        remediation_route: 'content',
      },
    ],
    evidence_pages: failing
      ? [
          {
            site_url_id: PAGE_A,
            source_analysis_id: ANALYSIS,
            normalized_url: 'https://acme.test/blogs/american-summer',
            failed_checks: [
              {
                rule_id: ruleId,
                title: 'Answer is not stated first',
                observed_evidence: { observed: 'missing' },
                expected_capability: 'State the answer first.',
                remediation: 'Move the direct answer into the first paragraph.',
                content_addressable: true,
                remediation_route: 'content',
              },
              {
                rule_id: `rule.${key}.1`,
                title: 'No question headings',
                observed_evidence: { observed: 'missing' },
                expected_capability: 'Use question-shaped headings.',
                remediation: 'Add question-shaped headings.',
                content_addressable: true,
                remediation_route: 'content',
              },
            ],
          },
          {
            site_url_id: PAGE_B,
            source_analysis_id: ANALYSIS,
            normalized_url: 'https://acme.test/blogs/rooted-in-fall',
            failed_checks: [
              {
                rule_id: ruleId,
                title: 'Answer is not stated first',
                observed_evidence: { observed: 'missing' },
                expected_capability: 'State the answer first.',
                remediation: 'Move the direct answer into the first paragraph.',
                content_addressable: true,
                remediation_route: 'content',
              },
            ],
          },
        ]
      : [],
    evidence_truncated: false,
  };
}

function stubReadiness(overrides: Record<string, unknown> = {}) {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/site-health/aeo-readiness`, () =>
      HttpResponse.json({
        state: 'measured',
        crawl_id: CRAWL,
        score: 82,
        coverage: 0.95,
        profile_version: 'site-health-profile-1',
        schema_contract_version: 'site-health-schema-contract-1',
        scoring_version: 'sh-score-1',
        presentation_version: 'site-health-presentation-1',
        analyzer_version: 'page-v1',
        source_analysis_ids: [ANALYSIS],
        analysis_count: 5,
        affected_page_count: 2,
        dimensions: DIMENSIONS.map(([key, label], index) => dimension(key, label, index === 0)),
        limitations: [],
        ...overrides,
      }),
    ),
  );
}

describe('AEO Readiness', () => {
  it('renders all seven dimensions with a plain-language description', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await screen.findByRole('heading', { name: 'Readiness dimensions' });
    for (const [, label] of DIMENSIONS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/what answerability means in one sentence/i)).toBeInTheDocument();
  });

  it('counts pages that need work, never a bare evaluation total', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    const answerability = (await screen.findByText('Answerability')).closest('tr');
    expect(within(answerability!).getByText('Needs work')).toBeInTheDocument();
    expect(within(answerability!).getByText('83%')).toBeInTheDocument();
    expect(screen.queryByText(/evidence link/i)).toBeNull();
  });

  it('uses singular grammar when one checked page needs work', async () => {
    stubReadiness({
      dimensions: DIMENSIONS.map(([key, label], index) => {
        const base = dimension(key, label, index === 0);
        return index === 0 ? { ...base, checked_page_count: 1, failing_page_count: 1 } : base;
      }),
    });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getByText('1 page failed at least one check, worst first.')).toBeInTheDocument();
  });

  it('names checks by their catalog title and never by a rule id', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getAllByText(/Answer is not stated first/)).toHaveLength(3);
    expect(screen.queryByText(/rule\.answerability\.0/)).toBeNull();
    expect(screen.queryByText(/^aeo\./)).toBeNull();
  });

  it('labels errored dimensions and checks as incomplete, never passing', async () => {
    const dimensions = DIMENSIONS.map(([key, label], index) => {
      const base = dimension(key, label, false);
      return index === 0
        ? {
            ...base,
            error_count: 1,
            dimension_measurement_state: 'limited_evidence',
            checks: [{ ...base.checks[0], error_count: 1 }],
          }
        : base;
    });
    stubReadiness({ dimensions });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    // The pillar still reports its number, but an unresolved check bars the
    // top band: a perfect score over an incomplete set is not a pass.
    const row = (await screen.findByText('Answerability')).closest('tr');
    expect(within(row!).queryByText('Passing')).toBeNull();
    expect(within(row!).getByText('Nearly there')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View details for Answerability' }));
    expect(screen.getAllByText('Incomplete')).toHaveLength(1);
  });

  it('labels unknown-only checks as incomplete rather than not applicable', async () => {
    const dimensions = DIMENSIONS.map(([key, label], index) => {
      const base = dimension(key, label, false);
      return index === 0
        ? {
            ...base,
            unknown_count: 1,
            checks: [{ ...base.checks[0], satisfied_count: 0, unknown_count: 1 }],
          }
        : base;
    });
    stubReadiness({ dimensions });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0);
    expect(screen.queryByText('Did not apply')).not.toBeInTheDocument();
  });

  it('reveals the remediation for a check on demand', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(
      screen.getByText('Move the direct answer into the first paragraph.'),
    ).toBeInTheDocument();
  });

  it('lists each failing page once with the checks it failed', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    const link = screen.getByRole('link', { name: 'acme.test/blogs/american-summer' });
    expect(link).toHaveAttribute('href', `/site/crawls/${CRAWL}/pages/${PAGE_A}`);
    // One row per page — the old drawer repeated the URL once per rule.
    expect(screen.getAllByRole('link', { name: 'acme.test/blogs/american-summer' })).toHaveLength(
      1,
    );
    const row = link.closest('li');
    expect(within(row!).getByText(/No question headings/)).toBeInTheDocument();
    // Raw outcome tokens are gone.
    expect(screen.queryByText('fail')).toBeNull();
  });

  it('says a bounded evidence list is bounded rather than implying it is the total', async () => {
    stubReadiness({
      dimensions: DIMENSIONS.map(([key, label], index) => {
        const base = dimension(key, label, index === 0);
        return index === 0 ? { ...base, failing_page_count: 140, evidence_truncated: true } : base;
      }),
    });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getByText(/Showing the 2 most affected of 140 pages/)).toBeInTheDocument();
  });

  it('shows the persisted empty state rather than an empty grid', async () => {
    stubReadiness({ state: 'not_measured', crawl_id: null, limitations: ['Run a crawl first.'] });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Run a crawl first.');
  });

  it('does not turn a rounded score into a claim that every check passed', async () => {
    stubReadiness({
      dimensions: DIMENSIONS.map(([key, label], index) => {
        const base = dimension(key, label, false);
        return index === 0 ? { ...base, score: 99.6 } : base;
      }),
    });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    const row = (await screen.findByText('Answerability')).closest('tr');
    expect(within(row!).getByText('100')).toBeInTheDocument();
    expect(within(row!).getByText('Nearly there')).toBeInTheDocument();
  });

  it('gives a code-only page the fix prompt rather than no action at all', async () => {
    // Every finding names a next action. A page whose failures are all
    // template or header changes cannot open a draft or a roadmap, but it must
    // still hand the reader something to give a developer.
    stubReadiness({
      dimensions: DIMENSIONS.map(([key, label], index) => {
        const base = dimension(key, label, index === 0);
        if (index !== 0) return base;
        return {
          ...base,
          evidence_pages: base.evidence_pages.map((page) => ({
            ...page,
            failed_checks: [
              {
                ...page.failed_checks[0],
                rule_id: 'technical.hsts_present',
                content_addressable: false,
                remediation_route: 'code',
              },
            ],
          })),
        };
      }),
    });
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getAllByRole('button', { name: /Copy fix prompt/ }).length).toBeGreaterThan(0);
  });

  it('gives a page whose checks route to content the fix prompt too', async () => {
    stubReadiness();
    renderWithProviders(<AeoReadinessPanel projectId={PROJECT} crawlId={CRAWL} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'View details for Answerability' }),
    );
    expect(screen.getAllByRole('button', { name: /Copy fix prompt/ }).length).toBeGreaterThan(0);
  });
});
