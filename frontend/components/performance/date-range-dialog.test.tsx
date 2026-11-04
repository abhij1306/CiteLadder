import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { RangeSelection } from '@/lib/performance/performance';

import { DateRangeDialog } from './date-range-dialog';

const SELECTION: RangeSelection = {
  range: '3_months',
  from: '2026-05-01',
  to: '2026-07-31',
  compare: 'previous',
  compareFrom: '',
  compareTo: '',
};

function renderDialog(onApply = vi.fn()) {
  render(
    <DateRangeDialog
      open
      onOpenChange={() => undefined}
      selection={SELECTION}
      onApply={onApply}
      coverage={{ earliest: '2025-11-01', latest: '2026-10-31' }}
      yearOverYearAvailable={false}
    />,
  );
  return onApply;
}

describe('DateRangeDialog', () => {
  it('chooses Custom when the reader clicks into a date, without typing', async () => {
    const user = userEvent.setup();
    const onApply = renderDialog();
    const ranges = screen.getByRole('radiogroup', { name: 'Date range' });
    expect(within(ranges).getByRole('radio', { name: '3 months' })).toBeChecked();

    await user.click(screen.getByRole('textbox', { name: 'End date' }));

    expect(within(ranges).getByRole('radio', { name: 'Custom' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ ...SELECTION, range: 'custom' });
  });

  it('chooses the Custom comparison when the reader reaches a comparison date', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    const comparisons = screen.getByRole('radiogroup', { name: 'Comparison' });
    expect(within(comparisons).getByRole('radio', { name: 'Previous period' })).toBeChecked();

    await user.click(screen.getByRole('textbox', { name: 'Start date' }));

    expect(within(comparisons).getByRole('radio', { name: 'Custom' })).toBeChecked();
  });
});
