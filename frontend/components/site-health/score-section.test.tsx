import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';

import type { SiteHealthDashboard } from '@/lib/api/types';

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

    expect(screen.getAllByText('Not measured')).toHaveLength(3);
  });

  it('preserves unavailable measurement states when scores are absent', () => {
    const dashboard = {
      score_summary: {
        web_fundamentals_score: null,
        web_fundamentals_coverage: 0.5,
        web_fundamentals_state: 'limited_evidence',
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'excluded',
      },
    } as SiteHealthDashboard;

    render(<ScoreSection crawl={null} dashboard={dashboard} />);

    expect(screen.getAllByText('Limited evidence').length).toBeGreaterThan(0);
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

    expect(screen.getByRole('img', { name: 'Web Fundamentals score: 73' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Readiness score: 61' })).toBeInTheDocument();
    expect(screen.getByText('Partial audit · 60% coverage')).toBeInTheDocument();
    expect(screen.getByText('Partial audit · 70% coverage')).toBeInTheDocument();
    // The coverage card's value IS the coverage, so its caveat never repeats it.
    expect(screen.getByText('Partial audit')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Checklist Completion: 70%' })).toBeInTheDocument();
  });
});
