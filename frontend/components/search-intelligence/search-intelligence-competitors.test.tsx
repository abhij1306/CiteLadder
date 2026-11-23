import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';
import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { SearchIntelligenceCompetitors } from './search-intelligence-competitors';

const competitor = (name: string) => ({
  identity: name,
  label: name,
  hostname: `${name}.test`,
  registrable_domain: `${name}.test`,
  origin: `https://${name}.test`,
  source_kind: 'competitor' as const,
});

const dataset = {
  id: 'saved',
  dataset_kind: 'missing_keywords',
  comparison_origin: 'https://www.rival.test',
  provider_total: null,
  unique_rows_saved: 0,
} as SearchIntelligenceDataset;

it('distinguishes empty comparisons from unfetched data and opens the saved www comparison', async () => {
  const onOpen = vi.fn();
  render(
    <SearchIntelligenceCompetitors
      datasets={[dataset]}
      competitors={[competitor('rival'), competitor('other')]}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText('No results')).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /rival/ })).getAllByText('Not fetched'),
  ).toHaveLength(3);
  expect(
    within(screen.getByRole('row', { name: /other/ })).getAllByText('Not fetched'),
  ).toHaveLength(4);
  await userEvent.click(
    screen.getByRole('button', { name: 'No results Keywords they rank for and you don’t: rival' }),
  );
  expect(onOpen).toHaveBeenCalledWith(dataset);
});

it('says once that nothing was fetched and draws no figure columns', () => {
  render(
    <SearchIntelligenceCompetitors
      datasets={[]}
      competitors={[competitor('rival'), competitor('other')]}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('Competitive footprint not fetched yet')).toBeInTheDocument();
  expect(screen.queryByText('Not fetched')).toBeNull();
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    'Competitor',
  ]);
});
