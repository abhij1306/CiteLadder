import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import type { RankingRow } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';
import { RankingRowsTable } from './ranking-rows';

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    name: 'Acme',
    is_brand: false,
    logo_url: null,
    website_url: null,
    mention_rate: 0.5,
    citation_rate: 0.25,
    share_of_voice: 0.4,
    mention_count: 5,
    avg_position: null,
    ...overrides,
  };
}

const cellsOf = (name: string) =>
  within(screen.getByText(name).closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('RankingRowsTable', () => {
  it('sorts presence rates and breaks ties deterministically', () => {
    render(
      <RankingRowsTable
        rows={[
          row({ name: 'Zulu' }),
          row({ name: 'Acme' }),
          row({ name: 'Leader', mention_rate: 1 }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Leader')).toBeVisible();
    expect(within(rows[1]!).getByText('Acme')).toBeVisible();
  });
  it('shows the mean position as a column, apart from an unmeasured one', () => {
    render(
      <RankingRowsTable
        rows={[
          row({ name: 'Acme', is_brand: true, avg_position: 1.46 }),
          row({ name: 'Globex', mention_rate: 0.2 }),
        ]}
      />,
    );
    expect(screen.getByText('You')).toBeVisible();
    expect(
      screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([['Globex', expect.stringMatching(/\/competitors\/Globex$/)]]);
    expect(screen.getByRole('columnheader', { name: /^Position/ })).toBeVisible();
    expect(cellsOf('Acme').slice(2, 4)).toEqual(['40.0%', '1.5']);
    expect(cellsOf('Globex').slice(2, 4)).toEqual(['40.0%', '—Not measured']);
  });
  it('distinguishes measured zero, unavailable rates, and incomparable changes', () => {
    render(
      <RankingRowsTable
        rows={[
          row({ mention_rate: 0, win_answers: 0, win_rate: null }),
          row({ name: 'Unknown', mention_rate: null, win_answers: null }),
        ]}
      />,
    );
    expect(screen.getByText('0.0%')).toBeVisible();
    const unknown = screen.getByText('Unknown').closest('tr')!;
    expect(within(unknown).getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: /^Position/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Change' })).toBeVisible();
    expect(cellsOf('Acme')[3]).toMatch(/Not applicable$/);
    expect(cellsOf('Unknown')[3]).toMatch(/Not measured$/);
  });
  it('compares brands without an asymmetric answers-without-you column', () => {
    render(
      <RankingRowsTable rows={[row({ name: 'Globex', gap_count: 3, visibility_delta: 0.3 })]} />,
    );
    expect(screen.getByText('0.3 pp').parentElement).toHaveTextContent('up +0.3 pp');
    expect(screen.queryByRole('columnheader', { name: /answers without you/i })).toBeNull();
  });
  it('prefers the matched-subset change when the run has one', () => {
    render(
      <RankingRowsTable
        rows={[
          row({
            visibility_delta: 2,
            matched_visibility_delta: 10,
            matched_visibility_rate: 0.6,
            matched_response_count: 4,
          }),
        ]}
      />,
    );
    expect(screen.getByText('10.0 pp').parentElement).toHaveTextContent('up +10.0 pp');
    expect(screen.queryByText('Matched subset')).toBeNull();
  });
});
