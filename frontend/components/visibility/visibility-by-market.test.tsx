import { screen, within } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { VisibilityMarkets } from '@citeladder/contracts/visibility';

import { renderWithProviders as render } from '@/test/render';

import { VisibilityByMarket } from './visibility-by-market';

const market = (id: string | null, label: string) => ({
  id,
  label,
  country_code: '',
  language_code: '',
  is_default: id === null,
  created_at: null,
});
const US = market(null, 'United States · English');
const DE = market('55555555-5555-4555-8555-555555555555', 'Germany · German');
const FR = market('66666666-6666-4666-8666-666666666666', 'France · French');

const rows: VisibilityMarkets = {
  cohort: 'core',
  markets: [
    {
      market: US,
      state: 'measured',
      audit_id: '11111111-1111-4111-8111-111111111111',
      measured_at: '2026-10-10T00:00:00Z',
      mention_rate: 0.25,
      share_of_voice: 0.5,
      net_sentiment: 40,
      comparison_status: 'comparable',
      mention_rate_delta: 5,
      share_of_voice_delta: -2,
    },
    {
      market: FR,
      state: 'no_run',
      audit_id: null,
      measured_at: null,
      mention_rate: null,
      share_of_voice: null,
      net_sentiment: null,
      comparison_status: null,
      mention_rate_delta: null,
      share_of_voice_delta: null,
    },
  ],
};
const loaded = { data: rows, isError: false } as UseQueryResult<VisibilityMarkets>;

describe('Visibility by market', () => {
  it("shows each market's figures and a never-run market as not run, not zero", () => {
    render(
      <VisibilityByMarket
        query={loaded}
        markets={[US, DE, FR]}
        market={null}
        onSelectMarket={() => undefined}
      />,
    );
    const [, us, fr] = screen.getAllByRole('row');
    expect(
      within(us!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['United States · English', '25%', '+5.0 pp', '50%', '−2.0 pp', '+40']);
    expect(within(fr!).getByText('Not run')).toBeInTheDocument();
    expect(within(fr!).queryByText('0%')).not.toBeInTheDocument();
  });

  it('switches the page to a market picked from the table', () => {
    const onSelectMarket = vi.fn();
    render(
      <VisibilityByMarket
        query={loaded}
        markets={[US, DE, FR]}
        market={null}
        onSelectMarket={onSelectMarket}
      />,
    );
    screen.getByRole('button', { name: 'France · French' }).click();
    expect(onSelectMarket).toHaveBeenCalledWith(FR.id);
  });

  it('stays out of the way for a project with only its default market', () => {
    const { container } = render(
      <VisibilityByMarket
        query={loaded}
        markets={[US]}
        market={null}
        onSelectMarket={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
