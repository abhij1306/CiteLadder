import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';
import type {
  PerceptionResponse,
  PerceptionScore,
} from '@citeladder/contracts/visibility-perception';
import { PerceptionView } from './perception-brand';

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
  theme: 'Support',
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
  const brand = {
    name: 'Acme',
    is_brand: true,
    logo_url: null,
    website_url: null,
    score: score(),
    coverage,
    theme_mentions: [],
  };
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
        logo_url: null,
        website_url: null,
        score: score({ classified: 0, positive: 0, negative: 0, net_sentiment: null }),
        coverage: { ...coverage, mentions: 2, classified: 0 },
        theme_mentions: [],
      },
    ],
    engines: [],
    topics: [],
    prompts: [],
    themes: [{ theme: 'Ease of use', positive: 2, negative: 1, quotes: [quote] }],
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
  it('heads with the negative share only from the classified minimum', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    expect(screen.queryByRole('heading', { name: /^AI says/u })).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'How AI describes you' })).toHaveLength(1);
    const lede = within(screen.getByLabelText('Brand perception'));
    expect(lede.getAllByText('Too few classified')).toHaveLength(2);
    expect(lede.getByText('Too few answers')).toBeVisible();
    expect(lede.queryByText(/%/u)).toBeNull();
    unmount();

    const enough = score({ positive: 15, negative: 5, classified: 20, negative_share: 0.25 });
    render(
      <PerceptionView
        data={response({
          brand: {
            name: 'Acme',
            is_brand: true,
            logo_url: null,
            website_url: null,
            score: enough,
            coverage,
            theme_mentions: [],
          },
        })}
      />,
    );
    expect(
      screen.getByRole('heading', {
        name: 'AI says something negative about you in 25% of classified mentions',
      }),
    ).toBeVisible();
    expect(within(screen.getByLabelText('Brand perception')).getByText('75.0%')).toBeVisible();
  });

  it('shows the classified coverage and opens a theme to its quotes', () => {
    render(<PerceptionView data={response()} />);
    expect(within(screen.getByLabelText('Brand perception')).getByText('4 / 6')).toBeVisible();
    expect(
      screen.getByRole('button', {
        description: '1 pending · 1 unavailable (platform limit reached)',
      }),
    ).toHaveAccessibleName(/^Basis of /);
    expect(screen.getAllByRole('link', { name: '“support is slow”' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ease of use' }));
    const links = screen.getAllByRole('link', { name: '“support is slow”' });
    expect(links).toHaveLength(2);
    expect(links[1]).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN}?execution=${EXECUTION}`),
    );
    expect(screen.getByText('0 of 2')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: 'By source' }));
    expect(screen.getByText('reviews.example')).toBeVisible();
  });

  it('shows breakdown shares only from the minimum classified count', () => {
    const row = (key: string, s: PerceptionScore, mentions: number) => ({
      key,
      label: key,
      score: s,
      coverage: { ...coverage, mentions, classified: s.classified },
    });
    render(
      <PerceptionView
        data={response({
          topics: [
            row(
              'Payroll',
              score({ positive: 12, neutral: 4, negative: 3, mixed: 1, classified: 20 }),
              24,
            ),
            row('Invoicing', score({ classified: 3 }), 10),
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'By topic' }));
    const payroll = screen.getByRole('row', { name: /Payroll/u });
    expect(within(payroll).getByText('20 of 24')).toBeVisible();
    expect(within(payroll).getByText('60.0%')).toBeVisible();
    const invoicing = screen.getByRole('row', { name: /Invoicing/u });
    expect(within(invoicing).getByText('Too few classified (3 of the 20 needed)')).toBeVisible();
    expect(within(invoicing).queryByText(/%|^\+?\d+$/u)).toBeNull();
  });

  it('states the recommended count briefly, naming advice against only when it occurred', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    const basis = (description: string) => screen.getByRole('button', { description });
    expect(basis('2 of 5 answers naming you; 1 advised against')).toHaveAccessibleName(
      /^Basis of /,
    );
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
    expect(basis('0 of 4 answers naming you')).toHaveAccessibleName(/^Basis of /);
  });

  it('marks the classified counts unavailable when the brand has no score, never 0 of 0', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    expect(
      screen.getByRole('button', { description: '3 of 4 classified mentions' }),
    ).toHaveAccessibleName(/^Basis of /);
    unmount();

    render(<PerceptionView data={response({ brand: null })} />);
    expect(screen.queryByText(/of \d+ classified mentions/u)).toBeNull();
    expect(screen.queryByText(/0 of 0/u)).toBeNull();
  });

  it('says in one line that no source was cited alongside criticism', () => {
    render(<PerceptionView data={response({ drivers: [] })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'By source' }));
    expect(screen.getByText('No sources cited alongside criticism.')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'No sources cited alongside criticism.' }),
    ).toBeNull();
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
