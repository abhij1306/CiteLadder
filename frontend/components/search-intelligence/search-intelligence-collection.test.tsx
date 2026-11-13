import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vite-plus/test';
import type { SearchIntelligenceDataset } from '@/lib/api/search-intelligence';
import { SearchIntelligenceCollection } from './search-intelligence-collection';
import { useSearchCollection } from './search-intelligence-collection-state';
import { AllFilters } from '@/components/ui/all-filters';
import { openFilterRow } from '@/test/all-filters';
import { CollectionViewControl, collectionFilters } from './search-intelligence-controls';

vi.mock('./search-intelligence-dataset-view', () => ({
  SearchIntelligenceDatasetView: ({ dataset }: { dataset: SearchIntelligenceDataset }) => (
    <p>Dataset {dataset.id}</p>
  ),
}));

const saved = {
  id: 'first',
  dataset_kind: 'missing_keywords',
  comparison_origin: 'https://rival.test',
  target_origin: 'https://owned.test',
  target_hostname: 'owned.test',
} as SearchIntelligenceDataset;

/** The page's composition: the strip's controls above the tab's collection. */
function Tab({
  tab,
  datasets,
  initial = null,
}: Readonly<{
  tab: 'keywords' | 'competitors';
  datasets: SearchIntelligenceDataset[];
  initial?: SearchIntelligenceDataset | null;
}>) {
  const [selected, setSelected] = useState(initial);
  const collection = useSearchCollection({
    tab,
    datasets,
    competitors: [],
    selected,
    onSelect: setSelected,
  });
  if (!collection) return null;
  return (
    <>
      <CollectionViewControl collection={collection} />
      <AllFilters filters={collectionFilters(collection)} />
      <SearchIntelligenceCollection
        collection={collection}
        datasets={datasets}
        competitors={[]}
        onSelect={setSelected}
      />
    </>
  );
}

it('keeps an absent comparison kind on the selected competitor and clears it on return', async () => {
  const other = {
    ...saved,
    id: 'second',
    dataset_kind: 'shared_keywords',
    comparison_origin: 'https://other.test',
  };
  render(<Tab tab="competitors" datasets={[saved, other]} initial={saved} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Shared keywords' }));
  expect(screen.getByText('No saved shared keywords')).toBeInTheDocument();
  expect(screen.queryByText('Dataset second')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Missing keywords' }));
  expect(screen.getByText('Dataset first')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'All competitors' }));
  expect(screen.getByText('Competitive footprint')).toBeInTheDocument();
});

it('offers the keyword filters only while a keyword dataset is on screen', async () => {
  const ranking = { ...saved, id: 'ranking', dataset_kind: 'ranking_keywords' };
  const pages = { ...saved, id: 'pages', dataset_kind: 'organic_pages' };
  render(<Tab tab="keywords" datasets={[ranking, pages]} />);
  const user = userEvent.setup();
  expect(screen.getByText('Dataset ranking')).toBeInTheDocument();
  expect(await openFilterRow(user, 'Min. search volume', 'Any volume')).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('radio', { name: 'Top pages' }));
  expect(screen.getByText('Dataset pages')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^All filters/ }));
  expect(await screen.findByRole('menuitem', { name: /^Website/ })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: /^Min. search volume/ })).not.toBeInTheDocument();
});
