import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { TargetShelfEvidence } from './target-shelf-evidence';

const ACTION_ID = '11111111-1111-4111-8111-111111111111';
const snapshot = {
  product_visibility: 0.5,
  share_of_shelf: 0.5,
  average_shelf_position: 1,
  first_position_win_rate: 0.5,
  successful_execution_count: 2,
  recognized_slot_count: 2,
  ranked_execution_count: 2,
  measured_at: '2026-10-01T00:00:00Z',
};

describe('TargetShelfEvidence', () => {
  it('lists who held the shelf and links the Actions that can change it', () => {
    renderWithProviders(
      <TargetShelfEvidence
        shelf={{
          target: { kind: 'category', id: '22222222-2222-4222-8222-222222222222' },
          snapshot,
          holders: [
            {
              kind: 'approved_competitor',
              name: 'Rival Runner',
              brand: 'Rival',
              merchant_domain: 'rival.example',
              appearances: 2,
              best_rank: 1,
            },
            {
              kind: 'owned',
              name: 'Road Shoe',
              brand: 'Acme',
              merchant_domain: '',
              appearances: 1,
              best_rank: null,
            },
          ],
          unresolved_count: 3,
          actions: [{ id: ACTION_ID, title: 'Add the missing price', status: 'open' }],
        }}
      />,
    );

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringContaining('Add the missing price'),
      expect.stringMatching(
        /Rival Runner.*Rival · rival\.example · In 2 of 2 answers · best #1.*Competitor/,
      ),
      expect.stringMatching(/Road Shoe.*Acme · In 1 of 2 answers.*You/),
    ]);
    expect(screen.getByRole('link', { name: 'Add the missing price' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/agent/actions/${ACTION_ID}`),
    );
    expect(screen.getByText(/3 other recommendations named products outside/)).toBeVisible();
  });

  it('says so when an answer named neither you nor a competitor', () => {
    renderWithProviders(
      <TargetShelfEvidence
        shelf={{
          target: { kind: 'product', id: '22222222-2222-4222-8222-222222222222' },
          snapshot,
          holders: [],
          unresolved_count: 0,
          actions: [],
        }}
      />,
    );

    expect(screen.getByText('No answer recommended you or an approved competitor.')).toBeVisible();
    expect(screen.queryByText('Actions for this target')).not.toBeInTheDocument();
  });
});
