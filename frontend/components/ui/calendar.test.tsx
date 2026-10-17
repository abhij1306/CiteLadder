import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Calendar } from './calendar';
import { DateField } from './date-field';

describe('Calendar', () => {
  it('selects the exact ISO day that was clicked', () => {
    // The day must survive the round trip unshifted: parsing an ISO day into a
    // local Date and formatting it back moves it across a day boundary either
    // side of UTC, which is how a picker returns "yesterday".
    const onSelect = vi.fn();
    render(<Calendar value="2026-09-05" onSelect={onSelect} ariaLabel="Start date" />);
    fireEvent.click(screen.getByRole('button', { name: '2026-09-01' }));
    expect(onSelect).toHaveBeenCalledWith('2026-09-01');
  });

  it('marks the selected day and no other', () => {
    render(<Calendar value="2026-09-05" onSelect={vi.fn()} ariaLabel="Start date" />);
    const pressed = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName('2026-09-05');
  });

  it('disables days outside the imported coverage', () => {
    render(
      <Calendar
        value="2026-09-05"
        onSelect={vi.fn()}
        min="2026-09-03"
        max="2026-09-20"
        ariaLabel="Start date"
      />,
    );
    expect(screen.getByRole('button', { name: '2026-09-02' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026-09-03' })).toBeEnabled();
  });

  it('ignores a date that only looks valid', () => {
    // Date.UTC OVERFLOWS: Feb 31 becomes March 3. The shape test alone would
    // accept it and the grid would open on the wrong month.
    render(<Calendar value="2026-02-31" onSelect={vi.fn()} ariaLabel="Start date" />);
    const pressed = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(0);
  });

  it('moves between months without changing the selection', () => {
    const onSelect = vi.fn();
    render(<Calendar value="2026-09-05" onSelect={onSelect} ariaLabel="Start date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('DateField', () => {
  it('accepts a typed date without opening the calendar', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} ariaLabel="Start date" />);
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-09-05' },
    });
    expect(onChange).toHaveBeenCalledWith('2026-09-05');
  });
});
