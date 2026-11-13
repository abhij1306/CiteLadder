import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vite-plus/test';

import { AllFilters } from '@/components/ui/all-filters';
import { chooseFilterOption, openFilterOptions } from '@/test/all-filters';

import { keywordFilters } from './search-intelligence-controls';

function Filters() {
  const [minVolume, setMinVolume] = useState('');
  const [intent, setIntent] = useState('');
  return (
    <>
      <AllFilters filters={keywordFilters({ minVolume, setMinVolume, intent, setIntent })} />
      <output>{`${minVolume}|${intent}`}</output>
    </>
  );
}

it('keeps only nonnegative whole minimum volumes', async () => {
  render(<Filters />);
  await openFilterOptions(userEvent.setup(), 'Min. search volume');
  const input = await screen.findByRole('spinbutton', { name: 'Minimum search volume' });
  fireEvent.change(input, { target: { value: '-1' } });
  fireEvent.change(input, { target: { value: '1.5' } });
  expect(input).toHaveValue(null);
  fireEvent.change(input, { target: { value: '10' } });
  expect(screen.getByText('10|')).toBeInTheDocument();
});

it('names every intent in sentence case and filters on the chosen one', async () => {
  const user = userEvent.setup();
  render(<Filters />);
  await openFilterOptions(user, 'Intent');
  expect((await screen.findAllByRole('menuitemradio')).map((option) => option.textContent)).toEqual(
    ['Any intent', 'Informational', 'Commercial', 'Navigational', 'Transactional'],
  );
  await user.keyboard('{Escape}{Escape}');
  await chooseFilterOption(user, 'Intent', 'Commercial');
  expect(screen.getByText('|commercial')).toBeInTheDocument();
});
