import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { Button } from './button';
import { DataTable } from './data-table';
import { TableActionsCell, TableCell, TableCellLines, TableRow, TableSelectCell } from './table';

const PROMPTS = ['Best CRM for startups', 'Cheapest CRM for agencies'];

/** A selectable table as a page builds one: the page owns which rows are selected. */
function SelectablePrompts() {
  const [selected, setSelected] = useState<readonly string[]>([]);
  let all: boolean | 'indeterminate' = false;
  if (selected.length === PROMPTS.length) all = true;
  else if (selected.length > 0) all = 'indeterminate';
  return (
    <DataTable
      title="Suggested prompts"
      columns={[{ key: 'prompt', label: 'Prompt' }]}
      selection={{
        all,
        noun: 'suggested prompts',
        onAllChange: (checked) => setSelected(checked ? PROMPTS : []),
      }}
    >
      {PROMPTS.map((prompt) => (
        <TableRow key={prompt}>
          <TableSelectCell
            label={`Select ${prompt}`}
            checked={selected.includes(prompt)}
            onCheckedChange={(checked) =>
              setSelected((current) =>
                checked ? [...current, prompt] : current.filter((item) => item !== prompt),
              )
            }
          />
          <TableCell>{prompt}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

describe('DataTable', () => {
  it('selects every row from the header box and shows a partial selection as mixed', () => {
    render(<SelectablePrompts />);
    const all = screen.getByRole('checkbox', { name: 'Select all suggested prompts' });

    fireEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Select Best CRM for startups' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Select Cheapest CRM for agencies' }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Best CRM for startups' }));
    expect(all).toHaveAttribute('aria-checked', 'mixed');
  });

  it('names the table by its title, with the description and a column caption beside it', () => {
    render(
      <DataTable
        title="AI referral sources"
        description="Shares use all GA4 source-report sessions."
        columns={[
          { key: 'source', label: 'Source' },
          { key: 'comparison', label: 'Sessions', numeric: true, sublabel: 'Previous period' },
        ]}
      >
        <TableRow>
          <TableCell>ChatGPT</TableCell>
          <TableCell numeric>12</TableCell>
        </TableRow>
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'AI referral sources' });
    expect(within(table).getAllByRole('columnheader')[1]).toHaveTextContent(
      'SessionsPrevious period',
    );
    expect(
      within(screen.getByRole('region', { name: 'AI referral sources' })).getByText(
        'Shares use all GA4 source-report sessions.',
      ),
    ).toBeVisible();
  });

  it('pads a short page of two-line rows with hidden blank rows of the same anatomy', () => {
    const { container } = render(
      <DataTable
        label="Signals"
        columns={[{ key: 'query', label: 'Query' }]}
        pageSize={3}
        rowCount={1}
        rowLines={2}
      >
        <TableRow>
          <TableCell>
            <TableCellLines title primary="crm software" secondary="/pricing" />
          </TableCell>
        </TableRow>
      </DataTable>,
    );
    const blanks = [...container.querySelectorAll('tbody tr[aria-hidden="true"]')];
    expect(blanks).toHaveLength(2);
    expect(blanks.map((row) => row.textContent)).toEqual(['  ', '  ']);
  });

  it('keeps a row’s actions together in its trailing cell', () => {
    render(
      <DataTable
        label="Sources"
        columns={[
          { key: 'host', label: 'Host' },
          { key: 'manage', label: 'Manage', width: 'rowActions' },
        ]}
      >
        <TableRow>
          <TableCell>example.com</TableCell>
          <TableActionsCell>
            <Button variant="secondary">Rotate token</Button>
            <Button variant="secondary">Revoke</Button>
          </TableActionsCell>
        </TableRow>
      </DataTable>,
    );
    const [, actions] = within(screen.getByRole('table', { name: 'Sources' })).getAllByRole('cell');
    expect(
      within(actions!)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Rotate token', 'Revoke']);
  });
});
