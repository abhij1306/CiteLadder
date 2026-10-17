import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { RankingRow } from '@/lib/api/types';
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

describe('RankingRowsTable', () => {
  it('discloses an empty selection', () => {
    render(<RankingRowsTable rows={[]} />);
    expect(screen.getByText('No measured responses in this selection.')).toBeVisible();
  });
  it('sorts presence rates and breaks ties deterministically without inventing ranks', () => {
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
  it('identifies the brand and shows actual citation measurements', () => {
    render(<RankingRowsTable rows={[row({ is_brand: true })]} />);
    expect(screen.getByText('You')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Citations' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Sentiment' })).toBeNull();
  });
  it('distinguishes measured zero, unavailable rates, and incomparable changes', () => {
    render(
      <RankingRowsTable
        rows={[row({ mention_rate: 0 }), row({ name: 'Unknown', mention_rate: null })]}
      />,
    );
    expect(screen.getByText('0%')).toBeVisible();
    const unknown = screen.getByText('Unknown').closest('tr')!;
    // Unmeasured visibility leaves the rank unmeasured too: a brand with no
    // measured presence has no standing to report, rather than last place.
    expect(within(unknown).getAllByText('Not measured').length).toBeGreaterThan(0);
    // With no prior run, NO brand has a change, so the column is not drawn at
    // all; the reason is stated once above the table.
    expect(screen.queryByRole('columnheader', { name: 'Change' })).toBeNull();
  });
  it('compares brands without an asymmetric answers-without-you column', () => {
    render(
      <RankingRowsTable rows={[row({ name: 'Globex', gap_count: 3, visibility_delta: 0.3 })]} />,
    );
    expect(screen.getByText('+0.3 pp')).toBeVisible();
    // The overlap measure is undefined for the tracked brand itself, so it is
    // not a column of a table whose every other column applies to every row.
    // It survives on `gap_count` for opportunity analysis.
    expect(screen.queryByRole('columnheader', { name: /answers without you/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /answers naming/i })).toBeNull();
  });
  it('ranks competitively over the rendered order, sharing a rank on ties', () => {
    render(
      <RankingRowsTable
        rows={[
          row({ name: 'Leader', mention_rate: 1 }),
          row({ name: 'Acme', mention_rate: 0.5 }),
          row({ name: 'Zulu', mention_rate: 0.5 }),
        ]}
      />,
    );
    // Named Rank so it does not read as the headline Average position.
    expect(screen.getByRole('columnheader', { name: 'Rank' })).toBeVisible();
    const cells = (name: string) =>
      within(screen.getByText(name).closest('tr')!).getByTitle(/ranks #/);
    expect(cells('Leader')).toHaveTextContent('#1');
    // Equal visibility is equal standing; the alphabetical tie-break orders the
    // rows but must not invent a difference in rank.
    expect(cells('Acme')).toHaveTextContent('#2');
    expect(cells('Zulu')).toHaveTextContent('#2');
  });
  it('selects a row to plot it alone, and re-selecting it restores every brand', () => {
    const onSelect = vi.fn();
    render(
      <RankingRowsTable
        rows={[row({ name: 'Globex' }), row({ name: 'Acme' })]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plot Globex on its own' }));
    expect(onSelect).toHaveBeenCalledWith('Globex');
    onSelect.mockClear();
    // Already-selected rows clear the focus, so one row both focuses and
    // restores rather than stranding the reader on a single-brand chart.
    render(
      <RankingRowsTable
        rows={[row({ name: 'Globex' })]}
        onSelect={onSelect}
        selectedName="Globex"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop plotting Globex on its own' }));
    expect(onSelect).toHaveBeenCalledWith(null);
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
    // Which comparison produced the number is explained once above the table,
    // so the cell shows the number and nothing else.
    expect(screen.getByText('+10.0 pp')).toBeVisible();
    expect(screen.queryByText('Matched subset')).toBeNull();
  });
});
