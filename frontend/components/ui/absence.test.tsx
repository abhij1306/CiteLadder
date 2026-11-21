import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { ABSENCE_STATES } from '@/lib/format';
import { formatRate } from '@/lib/visibility/dashboard';

import { Absence } from './absence';

describe('Absence', () => {
  it('prints every absence state as the one dash, each named apart', () => {
    const names = ABSENCE_STATES.map((state) => {
      const { container, unmount } = render(<Absence state={state} />);
      const face = container.querySelector(`[data-absence="${state}"]`);
      const shown = face?.querySelector('[aria-hidden]')?.textContent;
      const name = face?.querySelector('.sr-only')?.textContent;
      unmount();
      expect(shown).toBe('—');
      return name;
    });
    expect(new Set(names).size).toBe(ABSENCE_STATES.length);
  });

  it('draws the mark for a formatter absence and prints text that reads like one', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>None</TableCell>
            <TableCell numeric>{formatRate(null)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const [text, missing] = screen.getAllByRole('cell');
    expect(text).toHaveTextContent('None');
    expect(text?.querySelector('[data-absence]')).toBeNull();
    expect(missing?.querySelector('[data-absence="not_measured"]')).toHaveTextContent(
      '—Not measured',
    );
  });
});
