import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';
import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { SearchIntelligenceCollection } from './search-intelligence-collection';

vi.mock('./search-intelligence-dataset-view', () => ({
  SearchIntelligenceDatasetView: ({ dataset }: { dataset: SearchIntelligenceDataset }) => (
    <p>Dataset {dataset.id}</p>
  ),
}));

it('keeps an absent comparison kind on the selected competitor and clears it on return', async () => {
  const saved = {
    id: 'first',
    dataset_kind: 'missing_keywords',
    comparison_origin: 'https://rival.test',
    target_hostname: 'owned.test',
  } as SearchIntelligenceDataset;
  const other = {
    ...saved,
    id: 'second',
    dataset_kind: 'shared_keywords',
    comparison_origin: 'https://other.test',
  };
  function View() {
    const [selected, setSelected] = useState<SearchIntelligenceDataset | null>(saved);
    return (
      <SearchIntelligenceCollection
        tab="competitors"
        datasets={[saved, other]}
        competitors={[]}
        selected={selected}
        onSelect={setSelected}
      />
    );
  }
  render(<View />);
  await userEvent.click(screen.getByRole('radio', { name: 'Shared keywords' }));
  expect(screen.getByText('No saved shared keywords')).toBeInTheDocument();
  expect(screen.queryByText('Dataset second')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Missing keywords' }));
  expect(screen.getByText('Dataset first')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'All competitors' }));
  expect(screen.getByText('Competitive footprint')).toBeInTheDocument();
});
