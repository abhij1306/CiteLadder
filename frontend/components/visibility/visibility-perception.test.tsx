import { screen, within } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';
import type {
  PerceptionResponse,
  PerceptionScore,
} from '@citeladder/contracts/visibility-perception';
import { PerceptionView } from './visibility-perception';

const RUN = '11111111-1111-4111-8111-111111111111';
const EXECUTION = '22222222-2222-4222-8222-222222222222';

function score(overrides: Partial<PerceptionScore> = {}): PerceptionScore {
  return {
    positive: 3,
    neutral: 0,
    negative: 1,
    mixed: 0,
    classified: 4,
    positive_share: 0.75,
    negative_share: 0.25,
    net_sentiment: 50,
    ...overrides,
  };
}

const coverage = {
  mentions: 6,
  classified: 4,
  pending: 1,
  not_assessable: 0,
  low_confidence: 0,
  unavailable: [{ reason: 'platform_cap' as const, count: 1 }],
};

const quote = {
  text: 'support is slow',
  theme: 'support',
  polarity: 'negative' as const,
  entity: 'Acme',
  is_brand: true,
  logical_engine: 'chatgpt',
  prompt: 'best tools?',
  run_id: RUN,
  execution_id: EXECUTION,
  observed_at: '2026-10-01T00:00:00Z',
  extractor_version: 'x1',
  template_version: 't1',
};

function response(overrides: Partial<PerceptionResponse> = {}): PerceptionResponse {
  const brand = { name: 'Acme', is_brand: true, score: score(), coverage };
  return {
    state: 'value',
    reason: null,
    source_audit_ids: [RUN],
    brand,
    coverage,
    entities: [
      brand,
      {
        name: 'Rival',
        is_brand: false,
        score: score({ classified: 0, positive: 0, negative: 0, net_sentiment: null }),
        coverage: { ...coverage, mentions: 2, classified: 0 },
      },
    ],
    engines: [],
    topics: [],
    prompts: [],
    themes: [{ theme: 'ease_of_use', positive: 2, negative: 1, quotes: [quote] }],
    negative_quotes: [quote],
    drivers: [{ domain: 'reviews.example', answers: 1, example_url: null }],
    recommended: {
      mentioned: 5,
      recommended: 2,
      recommended_against: 1,
      rate: 0.4,
      limitation: 'English phrasing only.',
    },
    trend: [],
    ...overrides,
  };
}

describe('Perception view', () => {
  it('shows net sentiment with its coverage, and links each quote to its answer', () => {
    render(<PerceptionView data={response()} />);
    expect(within(screen.getByLabelText('Brand perception')).getByText('+50')).toBeVisible();
    expect(
      screen.getByText(
        '4 of 6 mentions classified · 1 pending · 1 unavailable (platform limit reached)',
      ),
    ).toBeVisible();
    expect(screen.getByText('Ease of use')).toBeVisible();
    const links = screen.getAllByRole('link', { name: '“support is slow”' });
    expect(links[0]).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN}?execution=${EXECUTION}`),
    );
    expect(screen.getByText('0 of 2')).toBeVisible();
    expect(screen.getByText('reviews.example')).toBeVisible();
  });

  it('states the recommended count briefly, naming advice against only when it occurred', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    expect(screen.getByText('2 of 5 answers naming you; 1 advised against')).toBeVisible();
    unmount();

    render(
      <PerceptionView
        data={response({
          recommended: {
            mentioned: 4,
            recommended: 0,
            recommended_against: 0,
            rate: 0,
            limitation: 'English phrasing only.',
          },
        })}
      />,
    );
    expect(screen.getByText('0 of 4 answers naming you')).toBeVisible();
  });

  it.each([
    ['pending', null, 'Classifying answers…'],
    ['unavailable', 'model_not_configured', 'Perception unavailable'],
    ['no_mentions', null, 'No answers named you'],
  ] as const)('renders the %s state instead of a zero', (state, reason, heading) => {
    render(<PerceptionView data={response({ state, reason })} />);
    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByLabelText('Brand perception')).toBeNull();
  });
});
