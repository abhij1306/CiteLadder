import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

const LONG = 'Structured-data names match the visible title and h1 content of the page';

function renderCell() {
  render(
    <TooltipProvider>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>{LONG}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TooltipProvider>,
  );
}

/** jsdom has no layout; give every element the box a clamped cell would have. */
function layout({ scrollHeight }: { scrollHeight: number }) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
}

afterEach(() => vi.restoreAllMocks());

describe('table cell text', () => {
  it('shows the full text in a tooltip when the cell cut it', async () => {
    layout({ scrollHeight: 60 });
    renderCell();

    await userEvent.hover(screen.getByText(LONG));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(LONG);
  });

  it('shows no tooltip when the text fits', async () => {
    layout({ scrollHeight: 40 });
    renderCell();

    await userEvent.hover(screen.getByText(LONG));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
