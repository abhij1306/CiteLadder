import { screen } from '@testing-library/react';
import { figureText } from '@/test/figures';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';

import type { SiteHealthDashboard } from '@citeladder/contracts';

import { ScoreSection } from './score-section';

describe('ScoreSection', () => {
  it('shows each unavailable score state once', () => {
    const dashboard = {
      score_summary: {
        web_fundamentals_score: null,
        web_fundamentals_coverage: null,
        web_fundamentals_state: 'not_measured',
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'not_measured',
      },
    } as SiteHealthDashboard;

    render(<ScoreSection crawl={null} dashboard={dashboard} />);

    expect(screen.getAllByText('Not measured')).toHaveLength(5);
  });

  it('says how many checks ran under a partly checked score and keeps an excluded state', () => {
    const dashboard = {
      score_summary: {
        web_fundamentals_score: 73,
        web_fundamentals_coverage: 0.5,
        web_fundamentals_state: 'limited_evidence',
        web_fundamentals_checks: { run: 1_200, total: 1_250 },
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'excluded',
        aeo_readiness_checks: null,
      },
    } as SiteHealthDashboard;

    render(<ScoreSection crawl={null} dashboard={dashboard} />);

    expect(figureText('Web fundamentals')).toBe('73');
    expect(screen.getByText('1,200 of 1,250 checks run')).toBeInTheDocument();
    expect(screen.queryByText(/Limited evidence/)).toBeNull();
    expect(screen.getAllByText(/Excluded/).length).toBeGreaterThan(0);
  });

  it('shows observed scores with explicit checklist completion', () => {
    const dashboard = {
      score_summary: {
        web_fundamentals_score: 73,
        web_fundamentals_coverage: 0.6,
        web_fundamentals_state: 'limited_evidence',
        aeo_readiness_score: 61,
        aeo_measurement_coverage: 0.7,
        aeo_measurement_state: 'limited_evidence',
      },
    } as SiteHealthDashboard;

    render(<ScoreSection crawl={null} dashboard={dashboard} />);

    expect(figureText('Web fundamentals')).toBe('73');
    expect(figureText('AEO readiness')).toBe('61');
    expect(figureText('AEO checklist completion')).toBe('70%');
  });
});
