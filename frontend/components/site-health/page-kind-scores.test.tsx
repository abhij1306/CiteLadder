import { describe, expect, it } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';

import { PageKindScores } from './page-kind-scores';
import type { SiteCrawl, SiteHealthDashboard, SiteScoreSummary } from '@/lib/api/types';
import { COMPLETE_CLASSIFICATION_PROJECTION } from '@/test/site-health-fixtures';
import { SITE_HEALTH_UUID as PROJECT, makeSiteCrawl } from '@/test/fixtures/site-health';

function summary(overrides: Partial<SiteScoreSummary> = {}): SiteScoreSummary {
  return {
    web_fundamentals_score: 80,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 62,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    search_eligibility: 'eligible',
    selected_count: 10,
    analyzed_count: 4,
    issue_count: 3,
    scoring_version: 's1',
    ...COMPLETE_CLASSIFICATION_PROJECTION,
    by_page_kind: {},
    ...overrides,
  };
}

function dashboard(scoreSummary: SiteScoreSummary | null): SiteHealthDashboard {
  return {
    project_id: PROJECT,
    crawl: null,
    score_summary: scoreSummary,
    phase: 'dashboard',
    snapshot_id: null,
    quota: { used: 4, limit: 50 },
    root_errors: [],
  };
}

function crawl(scoreSummary: SiteScoreSummary | null): SiteCrawl {
  return makeSiteCrawl({ score_summary: scoreSummary });
}

describe('PageKindScores', () => {
  it('renders nothing before any score summary exists', () => {
    const { container } = render(<PageKindScores crawl={null} dashboard={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the empty state when no page has been classified yet', () => {
    render(<PageKindScores crawl={null} dashboard={dashboard(summary())} />);
    expect(screen.getByTestId('page-kind-scores')).toBeInTheDocument();
    expect(
      screen.getByText('Per-page-kind scores appear once the analysis classifies your pages.'),
    ).toBeInTheDocument();
  });

  it('renders one row per classified type with analyzed count + mean scores', () => {
    render(
      <PageKindScores
        crawl={null}
        dashboard={dashboard(
          summary({
            by_page_kind: {
              article: {
                analyzed_count: 3,
                web_fundamentals_score: 80,
                web_fundamentals_coverage: 1,
                web_fundamentals_state: 'measured',
                aeo_readiness_score: 62,
                aeo_measurement_coverage: 0.8,
                aeo_measurement_state: 'measured',
                aeo_measurement_reason: '',
              },
              homepage: {
                analyzed_count: 1,
                web_fundamentals_score: 90.5,
                web_fundamentals_coverage: 1,
                web_fundamentals_state: 'measured',
                aeo_readiness_score: 70,
                aeo_measurement_coverage: 0.8,
                aeo_measurement_state: 'measured',
                aeo_measurement_reason: '',
              },
            },
          }),
        )}
      />,
    );
    // Humanized type badges.
    expect(screen.getByText('Homepage')).toBeInTheDocument();
    expect(screen.getByText('Article')).toBeInTheDocument();
    // Analyzed counts.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // Mean scores formatted like every other score cell.
    expect(screen.getByText('80')).toBeInTheDocument();
    // Scores render as whole numbers everywhere.
    expect(screen.getByText('91')).toBeInTheDocument();
    // PAGE_KINDS display order: Homepage row precedes the Article row.
    const homepage = screen.getByText('Homepage');
    const article = screen.getByText('Article');
    expect(
      homepage.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders not measured for a missing mean score, never a fabricated zero', () => {
    render(
      <PageKindScores
        crawl={null}
        dashboard={dashboard(
          summary({
            by_page_kind: {
              docs: {
                analyzed_count: 2,
                web_fundamentals_score: null,
                web_fundamentals_coverage: null,
                web_fundamentals_state: 'not_measured',
                aeo_readiness_score: null,
                aeo_measurement_coverage: null,
                aeo_measurement_state: 'not_measured',
                aeo_measurement_reason: '',
              },
            },
          }),
        )}
      />,
    );
    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
  });

  it('shows a non-null limited score with subordinate coverage and preserves excluded state', () => {
    render(
      <PageKindScores
        crawl={null}
        dashboard={dashboard(
          summary({
            by_page_kind: {
              docs: {
                analyzed_count: 2,
                web_fundamentals_score: 46,
                web_fundamentals_coverage: 0.5,
                web_fundamentals_state: 'limited_evidence',
                aeo_readiness_score: null,
                aeo_measurement_coverage: null,
                aeo_measurement_state: 'excluded',
                aeo_measurement_reason: '',
              },
            },
          }),
        )}
      />,
    );

    expect(screen.getByText('46')).toBeInTheDocument();
    expect(screen.getByText('Partial audit · 50% coverage')).toBeInTheDocument();
    expect(screen.getByText('Excluded')).toBeInTheDocument();
  });

  it('surfaces classifier abstentions without converting them into readiness values', () => {
    render(
      <PageKindScores
        crawl={null}
        dashboard={dashboard(
          summary({
            analyzed_count: 10,
            classified_page_count: 6,
            other_page_count: 4,
            classification_expected_page_count: 10,
            classification_coverage: 0.6,
            classification_state: 'partial',
            classification_reason_groups: { no_signals: 4 },
            scored_page_kind_set: ['article'],
            scored_page_count_by_kind: { article: 6 },
            by_page_kind: {
              article: {
                analyzed_count: 6,
                web_fundamentals_score: 80,
                web_fundamentals_coverage: 1,
                web_fundamentals_state: 'measured',
                aeo_readiness_score: 70,
                aeo_measurement_coverage: 0.8,
                aeo_measurement_state: 'measured',
                aeo_measurement_reason: '',
              },
              other: {
                analyzed_count: 4,
                web_fundamentals_score: 90,
                web_fundamentals_coverage: 1,
                web_fundamentals_state: 'measured',
                aeo_readiness_score: null,
                aeo_measurement_coverage: null,
                aeo_measurement_state: 'not_measured',
                aeo_measurement_reason: 'page_purpose_unresolved',
              },
            },
          }),
        )}
      />,
    );

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.queryByText(/purpose unresolved/i)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('falls back to the crawl score summary when the dashboard has none', () => {
    render(
      <PageKindScores
        crawl={crawl(
          summary({
            by_page_kind: {
              about_contact: {
                analyzed_count: 1,
                web_fundamentals_score: 55,
                web_fundamentals_coverage: 1,
                web_fundamentals_state: 'measured',
                aeo_readiness_score: 45,
                aeo_measurement_coverage: 0.8,
                aeo_measurement_state: 'measured',
                aeo_measurement_reason: '',
              },
            },
          }),
        )}
        dashboard={dashboard(null)}
      />,
    );
    expect(screen.getByTestId('page-kind-scores')).toBeInTheDocument();
    expect(screen.getByText('About / Contact')).toBeInTheDocument();
  });
});
