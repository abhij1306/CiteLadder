import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';
import type { AccuracyResponse } from '@citeladder/contracts/fact-checking';
import { AccuracyView } from './visibility-accuracy';

const RUN = '11111111-1111-4111-8111-111111111111';
const EXECUTION = '22222222-2222-4222-8222-222222222222';

const coverage = {
  claims: 5,
  supported: 2,
  contradicted: 1,
  inconclusive: 0,
  not_covered: 1,
  low_confidence: 0,
  pending: 1,
  unavailable: [],
  answers_pending: 0,
  answers_unavailable: 0,
};

function response(overrides: Partial<AccuracyResponse> = {}): AccuracyResponse {
  return {
    state: 'value',
    reason: null,
    source_audit_ids: [RUN],
    score: { accuracy: 2 / 3, coverage },
    topics: [{ key: 'pricing', label: 'pricing', score: { accuracy: 1, coverage } }],
    engines: [],
    contradicted: [
      {
        claim: 'Acme Pro costs $49 a month.',
        topic: 'pricing',
        quote: 'Acme Pro costs $49 per month',
        status: 'verdict',
        verdict: 'contradicted',
        reason: null,
        facts: [{ topic: 'pricing', statement: 'Pro costs $59 per month.', source_url: null }],
        logical_engine: 'chatgpt',
        prompt: 'best tools?',
        run_id: RUN,
        execution_id: EXECUTION,
        observed_at: '2026-10-01T00:00:00Z',
      },
    ],
    cited_alongside: [],
    trend: [],
    ...overrides,
  };
}

describe('AccuracyView', () => {
  it('shows accuracy with its coverage and each contradiction beside the fact it contradicts', () => {
    render(<AccuracyView data={response()} />);
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('4 of 5 claims checked · 1 pending')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '“Acme Pro costs $49 per month”' })).toHaveAttribute(
      'href',
      `/runs/${RUN}?execution=${EXECUTION}`,
    );
    expect(screen.getByText('Your fact: Pro costs $59 per month.')).toBeInTheDocument();
  });

  it('explains a read without a value instead of showing a zero', () => {
    render(
      <AccuracyView
        data={response({
          state: 'no_facts',
          score: { accuracy: null, coverage: { ...coverage, claims: 0 } },
          contradicted: [],
        })}
      />,
    );
    expect(screen.getByText('No confirmed facts for these runs')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
