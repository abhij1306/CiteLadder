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
  text: 'sizes run small',
  theme: 'Sizing',
  attribute: { kind: 'labelled' as const, name: 'Runs small' },
  polarity: 'negative' as const,
  entity: 'Acme',
  is_brand: true,
  logical_engine: 'chatgpt',
  prompt: 'best kids pyjamas?',
  run_id: RUN,
  execution_id: EXECUTION,
  observed_at: '2026-10-01T00:00:00Z',
  extractor_version: 'x1',
  template_version: 't1',
};

const categories = [
  {
    category: 'Low prices',
    mentions: 6,
    negative: 0,
    positive: 6,
    attributes: [],
  },
  {
    category: 'Sizing',
    mentions: 3,
    negative: 2,
    positive: 1,
    attributes: [{ attribute: 'Runs small', negative: 2, positive: 0, quotes: [quote] }],
  },
];

type Entity = PerceptionResponse['entities'][number];

function brand(overrides: Partial<Entity> = {}): Entity {
  return {
    name: 'Acme',
    is_brand: true,
    logo_url: null,
    website_url: null,
    score: score(),
    coverage,
    theme_mentions: [],
    categories,
    ...overrides,
  };
}

function response(overrides: Partial<PerceptionResponse> = {}): PerceptionResponse {
  return {
    state: 'value',
    reason: null,
    source_audit_ids: [RUN],
    brand: brand(),
    coverage,
    entities: [brand()],
    engines: [],
    topics: [],
    prompts: [],
    themes: [],
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

const figures = () => within(screen.getByLabelText('Brand perception'));

describe('Perception view', () => {
  it('shows shares as counts with a small-sample tag below the sample size and as percentages from it', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    expect(figures().getByText('3 / 4')).toBeVisible();
    expect(figures().getByText('1 / 4')).toBeVisible();
    expect(figures().getAllByText('Small sample')).toHaveLength(2);
    expect(figures().getByText('4 / 6')).toBeVisible();
    unmount();

    const enough = score({ positive: 15, negative: 5, classified: 20 });
    render(<PerceptionView data={response({ brand: brand({ score: enough }) })} />);
    expect(figures().getByText('75.0%')).toBeVisible();
    expect(figures().getByText('25.0%')).toBeVisible();
    expect(figures().queryByText('Small sample')).toBeNull();
  });

  it('ranks attributes by the chosen side and opens a category to its quotes', () => {
    render(<PerceptionView data={response()} />);
    const ranks = within(screen.getByRole('region', { name: 'Ranked attributes' }));
    expect(ranks.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Sizing2']);
    fireEvent.click(ranks.getByRole('radio', { name: 'Most positive' }));
    expect(ranks.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Low prices6',
      'Sizing1',
    ]);

    expect(screen.queryByRole('link', { name: '“sizes run small”' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sizing' }));
    expect(screen.getByRole('link', { name: '“sizes run small”' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN}?execution=${EXECUTION}`),
    );
    expect(screen.getByRole('link', { name: 'best kids pyjamas?' })).toBeVisible();
  });

  it('hides empty blocks and the trend until two runs, keeping the breakdown views with data', () => {
    const { unmount } = render(
      <PerceptionView
        data={response({
          brand: brand({
            categories: [],
            score: score({ classified: 0, positive: 0, negative: 0 }),
          }),
          drivers: [],
        })}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Ranked attributes' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sentiment' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Breakdown' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Net sentiment' })).toBeNull();
    unmount();

    const point = {
      audit_id: RUN,
      completed_at: '2026-10-01T00:00:00Z',
      score: score(),
      mentions: 4,
      extractor_version: 'x1',
      template_version: 't1',
      metrics_version: 'm1',
      comparable: true,
    };
    const later = {
      ...point,
      audit_id: '33333333-3333-4333-8333-333333333333',
      completed_at: '2026-10-08T00:00:00Z',
    };
    render(<PerceptionView data={response({ trend: [point, later] })} />);
    expect(screen.getByRole('region', { name: 'Sentiment' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Net sentiment' })).toBeVisible();
    const views = within(screen.getByRole('radiogroup', { name: 'Break perception down' }));
    expect(views.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'By attribute',
      'By source',
    ]);
    fireEvent.click(views.getByRole('radio', { name: 'By source' }));
    expect(screen.getByText('reviews.example')).toBeVisible();
  });

  it('switches breakdown shares to counts below the sample size', () => {
    const row = (key: string, s: PerceptionScore) => ({
      key,
      label: key,
      score: s,
      coverage: { ...coverage, mentions: s.classified + 2, classified: s.classified },
    });
    render(
      <PerceptionView
        data={response({
          topics: [
            row(
              'Payroll',
              score({ positive: 12, neutral: 4, negative: 3, mixed: 1, classified: 20 }),
            ),
            row('Invoicing', score({ positive: 2, negative: 1, classified: 3 })),
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'By topic' }));
    const payroll = screen.getByRole('row', { name: /Payroll/u });
    expect(within(payroll).getByText('60.0%')).toBeVisible();
    expect(within(payroll).queryByText('Small sample')).toBeNull();
    const invoicing = screen.getByRole('row', { name: /Invoicing/u });
    expect(within(invoicing).getByText('2 / 3')).toBeVisible();
    expect(within(invoicing).getByText('Small sample')).toBeVisible();
  });

  it('links to brand prompts only while too few answers describe the brand', () => {
    const { unmount } = render(<PerceptionView data={response()} />);
    expect(screen.getByRole('link', { name: 'add brand prompts' })).toHaveAttribute(
      'href',
      expect.stringContaining('/prompts/build?step=distribution&generate=brand'),
    );
    unmount();
    render(<PerceptionView data={response({ coverage: { ...coverage, classified: 20 } })} />);
    expect(screen.queryByRole('link', { name: 'add brand prompts' })).toBeNull();
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
