import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';
import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { SearchIntelligenceCompetitors } from './search-intelligence-competitors';

it('distinguishes empty comparisons from unfetched data and opens the saved www comparison', async () => {
  const dataset = {
    id: 'saved',
    dataset_kind: 'missing_keywords',
    comparison_origin: 'https://www.rival.test',
    provider_total: null,
    unique_rows_saved: 0,
  } as SearchIntelligenceDataset;
  const onOpen = vi.fn();
  render(
    <SearchIntelligenceCompetitors
      datasets={[dataset]}
      competitors={[
        {
          identity: 'rival',
          label: 'Rival',
          hostname: 'rival.test',
          registrable_domain: 'rival.test',
          origin: 'https://rival.test',
          source_kind: 'competitor',
        },
      ]}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText('No results')).toBeInTheDocument();
  // The footprint and shared-keyword comparison were never fetched: not a missing measurement.
  expect(screen.getAllByText('Not fetched')).toHaveLength(3);
  await userEvent.click(
    screen.getByRole('button', { name: 'Rival: Keywords they rank for and you don’t' }),
  );
  expect(onOpen).toHaveBeenCalledWith(dataset);
});
