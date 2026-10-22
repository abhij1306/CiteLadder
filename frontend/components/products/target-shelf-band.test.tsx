import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import type { Shelf } from '@citeladder/contracts/commerce-suite';

import { renderWithProviders } from '@/test/render';

import { TargetShelfBand } from './target-shelf-band';

type Snapshot = NonNullable<Shelf['snapshot']>;
const snapshot: Snapshot = {
  product_visibility: 0.25,
  share_of_shelf: 0.5,
  average_shelf_position: 2,
  first_position_win_rate: 0,
  successful_execution_count: 4,
  recognized_slot_count: 6,
  ranked_execution_count: 3,
  measured_at: '2026-10-01T12:00:00Z',
};

function shelfQuery(value: Snapshot | null) {
  return {
    isPending: false,
    isError: false,
    data: { target: null, snapshot: value, holders: [], unresolved_count: 0, actions: [] },
  } as never;
}

describe('TargetShelfBand', () => {
  it('shows an unmeasured target as not measured, with no figures', () => {
    renderWithProviders(<TargetShelfBand query={shelfQuery(null)} />);

    expect(screen.getAllByText('Not measured')).toHaveLength(4);
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Measured/)).not.toBeInTheDocument();
    expect(screen.getByText('Share of answers that recommended you.')).toBeVisible();
  });

  it('shows observed values as figures with the answers they rest on', () => {
    renderWithProviders(<TargetShelfBand query={shelfQuery(snapshot)} />);

    expect(screen.getByText('25.0%')).toBeVisible();
    expect(screen.getByText('0.0%')).toBeVisible();
    expect(screen.getByText(/from 4 answers and 6 recognized recommendations/)).toBeVisible();
  });

  it('reports visibility unavailable, not zero, when no answer succeeded', () => {
    renderWithProviders(
      <TargetShelfBand
        query={shelfQuery({
          ...snapshot,
          product_visibility: null,
          share_of_shelf: null,
          average_shelf_position: null,
          first_position_win_rate: null,
          successful_execution_count: 0,
          recognized_slot_count: 0,
        })}
      />,
    );

    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
  });
});
