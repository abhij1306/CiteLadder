import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Inbox } from '@/lib/icons';
import { ApiError } from '@/lib/api/errors';

import { Avatar } from './avatar';
import { Button } from './button';
import { Delta } from './delta';
import { choiceFilter, rangeFilter, singleFilter, type FilterIcon } from './all-filters';
import { FilterBar } from './filter-bar';
import { DataTable } from './data-table';
import { Meter } from './meter';
import { Pager, pageNumberControls } from './pager';
import { StateBlock } from './state-block';
import { SearchField } from './search-field';
import { FigureStrip } from './figure-strip';
import { Table, TableCell, TableHeader, TableRow } from './table';
import { SortableTableHead } from './table-heads';
import { SegmentedControl } from './tabs';
import { focusByKeyboard } from '@/test/keyboard-focus';
import { renderWithProviders } from '@/test/render';

import { ArrowLink, TextLink } from './text-link';
import { TooltipProvider } from './tooltip';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';

describe('SectionHeader actions', () => {
  it('keeps the actions in the header beside the title', () => {
    render(
      <Section aria-label="Issues">
        <SectionHeader actions={<Button>Export</Button>}>
          <SectionTitle>Issues</SectionTitle>
        </SectionHeader>
      </Section>,
    );
    const header = screen.getByRole('heading', { name: 'Issues' }).closest('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole('button', { name: 'Export' })).toBeVisible();
  });
});

function spokenText(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[aria-hidden="true"]')) text += node.textContent ?? '';
  }
  return text;
}

describe('Delta', () => {
  it('says the rounded direction in words, tones it by policy and never fakes a zero', () => {
    const { container, rerender } = render(
      <Delta value={-1.24} unit=" pp" policy="lower-is-better" context="vs last week" />,
    );
    const fall = screen.getByText('1.2 pp').closest('[data-direction]');
    expect(fall?.textContent).toBe('down −1.2 ppvs last week');
    expect(fall ? spokenText(fall) : null).toBe('down 1.2 ppvs last week');
    expect(fall).toHaveAttribute('data-outcome', 'improved');

    rerender(<Delta value={0.04} unit=" pp" />);
    const flat = container.querySelector('[data-direction]');
    expect(flat).toHaveAttribute('data-direction', 'flat');
    expect(flat?.textContent).toBe('no change±0 pp');
    expect(flat ? spokenText(flat) : null).toBe('no change');

    rerender(
      <TooltipProvider>
        <Delta value={null} missingReason="No comparable run" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Not measured' })).toBeInTheDocument();
  });
});

describe('FigureStrip', () => {
  it('names a missing value, prints a real zero and makes a pressable figure a toggle', () => {
    const onSelect = vi.fn();
    const onConnect = vi.fn();
    renderWithProviders(
      <FigureStrip
        label="Delivery"
        segments={[
          {
            key: 'ttfb',
            label: 'TTFB',
            value: null,
            action: { label: 'Connect logs', onSelect: onConnect },
          },
          { key: 'errors', label: 'Errors', value: 0 },
          {
            key: 'score',
            label: 'Crawl',
            value: '72',
            sub: 'Last crawl',
            action: { label: 'View details', href: '/issues' },
          },
          {
            key: 'orphans',
            label: 'Orphaned pages',
            value: 3,
            actionLabel: 'View 3 orphaned pages',
            onSelect,
            selected: false,
          },
        ]}
      />,
      { projectSelection: null },
    );
    const group = screen.getByRole('group', { name: 'Delivery' });
    const cell = (label: string) => within(group).getByText(label).closest('[data-figure-cell]');
    expect(cell('TTFB')).toHaveTextContent('Not measured');
    expect(cell('Errors')?.textContent).toBe('Errors0');
    expect(cell('Crawl')?.textContent).toBe('CrawlLast crawl72');
    expect(
      within(group).getByRole('button', { name: 'Basis of Crawl' }),
    ).toHaveAccessibleDescription('Last crawl');
    fireEvent.click(within(group).getByRole('button', { name: 'TTFB' }));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(within(group).getByRole('link', { name: 'Crawl' })).toHaveAttribute('href', '/issues');
    const toggle = within(group).getByRole('button', { name: 'View 3 orphaned pages' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('puts a comparison window in the figure hint, its absence named like the value', () => {
    render(
      <FigureStrip
        label="Search Console metrics"
        segments={[
          {
            key: 'clicks',
            label: 'Clicks',
            value: '1,204',
            comparison: { label: 'Previous 28 days', value: '980' },
          },
          {
            key: 'ctr',
            label: 'CTR',
            value: '2.1%',
            missingLabel: 'Not measured',
            comparison: { label: 'Previous 28 days', value: null },
          },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Search Console metrics' });
    const [clicks, ctr] = within(group).getAllByText(/^Previous 28 days/);
    expect(clicks?.closest('[data-figure-comparison]')?.textContent).toBe('Previous 28 days: 980');
    expect(ctr?.closest('[data-figure-comparison]')?.textContent).toBe(
      'Previous 28 days: Not measured',
    );
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'count', label: 'Count', kind: 'number' },
  ] as const;

  it('draws only the rows a short page has and gives way to one empty state, head included', () => {
    const { container, rerender } = render(
      <DataTable title="Runs" columns={columns} pageSize={5} rowCount={2}>
        <TableRow>
          <TableCell>Alpha</TableCell>
          <TableCell numeric>1</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Beta</TableCell>
          <TableCell numeric>2</TableCell>
        </TableRow>
      </DataTable>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Runs' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeVisible();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    rerender(
      <DataTable
        title="Runs"
        columns={columns}
        pageSize={5}
        state={{ kind: 'empty', icon: Inbox, heading: 'No failed runs' }}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: 'Count' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'No failed runs' })).toBeVisible();
  });

  it('puts an unsortable column caveat behind its header and a note under the table', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DataTable
          label="Sources"
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'type', label: 'Type', hint: 'How the publisher is classified.' },
          ]}
          footer="Showing the newest 50."
        >
          <TableRow>
            <TableCell>Alpha</TableCell>
            <TableCell>Editorial</TableCell>
          </TableRow>
        </DataTable>
      </TooltipProvider>,
    );
    const head = screen.getByRole('columnheader', { name: 'Type' });
    focusByKeyboard(within(head).getByRole('button', { name: 'Type' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'How the publisher is classified.',
    );
    expect(
      within(screen.getByRole('region', { name: 'Sources' })).getByText('Showing the newest 50.'),
    ).toBeVisible();
  });
});

describe('Meter', () => {
  it('names the bar by its visible label and speaks the shown value, clamped to the maximum', () => {
    const { rerender } = render(<Meter label="Prompt runs" value={120} />);
    const meter = screen.getByRole('meter', { name: 'Prompt runs' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '120 / 100');
    expect(screen.getByText('120 / 100')).toBeVisible();

    rerender(<Meter label="ChatGPT" value={42} valueLabel="42%" />);
    expect(screen.getByRole('meter', { name: 'ChatGPT' })).toHaveAttribute('aria-valuetext', '42%');
  });

  it('announces an unmeasured value instead of drawing it as zero', () => {
    render(<Meter label="Mention rate" value={null} />);
    const meter = screen.getByRole('meter', { name: 'Mention rate' });
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(meter).toHaveAttribute('aria-valuetext', 'Not measured');
  });
});

describe('SortableTableHead', () => {
  it('announces the sort on the column and sorts from the header button', () => {
    const onSort = vi.fn();
    const head = (descending: boolean) => (
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              label="Clicks"
              active
              descending={descending}
              onSort={onSort}
              numeric
            />
            <SortableTableHead label="Page" active={false} descending onSort={vi.fn()} />
          </TableRow>
        </TableHeader>
      </Table>
    );
    const { rerender } = render(head(true));
    expect(screen.getByRole('columnheader', { name: 'Clicks' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Page' })).not.toHaveAttribute('aria-sort');
    fireEvent.click(screen.getByRole('button', { name: 'Clicks' }));
    expect(onSort).toHaveBeenCalledOnce();
    rerender(head(false));
    expect(screen.getByRole('columnheader', { name: 'Clicks' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });
});

describe('TextLink', () => {
  it('opens external links safely and renders unsafe ones as text', () => {
    const { rerender } = render(
      <TextLink variant="external" href="https://example.com/a">
        example.com
      </TextLink>,
    );
    const link = screen.getByRole('link', { name: 'example.com (opens in a new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(
      <TextLink variant="external" href="javascript:alert(1)">
        unsafe
      </TextLink>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('unsafe')).toBeInTheDocument();
    expect(screen.queryByText('(opens in a new tab)')).toBeNull();
  });
});

describe('ArrowLink', () => {
  it('links to a route under its label, and is plain text inside a linked card', () => {
    const { unmount } = renderWithProviders(<ArrowLink href="/runs">View all runs</ArrowLink>, {
      projectSelection: null,
    });
    expect(screen.getByRole('link', { name: 'View all runs' })).toHaveAttribute('href', '/runs');
    unmount();

    render(<ArrowLink>Open the report</ArrowLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Open the report')).toBeInTheDocument();
  });
});

describe('FilterBar and FilterTrigger', () => {
  it('lays every row out in one order: view, search, All filters, count, action', () => {
    render(
      <FilterBar
        actions={<Button>Export</Button>}
        status="12 pages"
        filters={[
          choiceFilter({
            id: 'kind',
            label: 'Page kind',
            value: 'faq',
            defaultValue: 'all',
            groups: [
              {
                options: [
                  { value: 'all', label: 'All page kinds' },
                  { value: 'faq', label: 'FAQ' },
                ],
              },
            ],
            onChange: () => undefined,
          }),
        ]}
        search={<SearchField value="" onValueChange={() => undefined} aria-label="Search pages" />}
        view={
          <SegmentedControl
            ariaLabel="Pages shown"
            value="all"
            onChange={() => undefined}
            options={[{ value: 'all', label: 'All' }]}
          />
        }
      />,
    );
    const order = [
      screen.getByRole('radiogroup', { name: 'Pages shown' }),
      screen.getByRole('searchbox', { name: 'Search pages' }),
      screen.getByRole('button', { name: 'Page kind: FAQ' }),
      screen.getByText('12 pages'),
      screen.getByRole('button', { name: 'Export' }),
    ];
    const follows = order
      .slice(1)
      .map((node, index) =>
        Boolean(order[index]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
    expect(follows).toEqual([true, true, true, true]);
  });
  it('keeps at most four icon filters in the row and the rest in Filters, a lone other one as its own chip', () => {
    const filter = (id: string, value = 'all', icon?: FilterIcon) =>
      choiceFilter({
        id,
        label: id,
        icon,
        value,
        defaultValue: 'all',
        groups: [
          {
            options: [
              { value: 'all', label: 'All' },
              { value: 'one', label: 'One' },
            ],
          },
        ],
        onChange: () => undefined,
      });
    const icons = [
      filter('Period', 'all', 'period'),
      filter('Engines', 'all', 'engines'),
      filter('Market', 'all', 'market'),
      filter('Topic', 'one', 'topic'),
    ];
    const { rerender } = render(
      <FilterBar
        filters={[filter('Kind', 'one'), ...icons, filter('Prompts', 'all', 'prompts')]}
      />,
    );
    for (const name of ['Period: All', 'Engines: All', 'Market: All', 'Topic: One'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prompts: All' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Kind filter' })).toBeInTheDocument();

    rerender(<FilterBar filters={[...icons, filter('Status')]} />);
    expect(screen.getByRole('button', { name: 'Status: All' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });
  it('clears every set filter at once, and a value chip resets its own', async () => {
    function Row() {
      const [period, setPeriod] = useState('30d');
      const [kind, setKind] = useState<string | null>('faq');
      const [status, setStatus] = useState<string | null>('open');
      const single = (id: string, value: string | null, set: (next: string | null) => void) =>
        singleFilter({
          id,
          label: id,
          allLabel: `All ${id}`,
          value,
          options: [
            { value: 'faq', label: 'FAQ' },
            { value: 'open', label: 'Open' },
          ],
          onChange: set,
        });
      return (
        <>
          <FilterBar
            filters={[
              rangeFilter({
                value: period,
                defaultValue: '90d',
                options: [
                  { value: '90d', label: 'Last 90 days' },
                  { value: '30d', label: 'Last 30 days' },
                ],
                onChange: setPeriod,
              }),
              single('Kind', kind, setKind),
              single('Status', status, setStatus),
            ]}
          />
          <output data-testid="state">{`${period} ${kind} ${status}`}</output>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Row />);
    await user.click(screen.getByRole('button', { name: 'Remove Kind filter' }));
    expect(screen.getByTestId('state')).toHaveTextContent('30d null open');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('state')).toHaveTextContent('90d null null');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
  it('prints only the icon of an icon filter at its default, and the value once set or on a plain chip', () => {
    const status = (value: string | null) =>
      singleFilter({
        id: 'status',
        label: 'Status',
        allLabel: 'All statuses',
        value,
        options: [{ value: 'open', label: 'Open' }],
        onChange: () => undefined,
      });
    const period = (value: string) =>
      rangeFilter({
        value,
        defaultValue: '30d',
        options: [
          { value: '30d', label: 'Last 30 days' },
          { value: '7d', label: 'Last 7 days' },
        ],
        onChange: () => undefined,
      });
    const { rerender } = render(<FilterBar filters={[period('30d'), status(null)]} />);
    expect(screen.getByRole('button', { name: 'Period: Last 30 days' }).textContent).toBe('');
    expect(screen.getByText('Last 30 days')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Status: All statuses' })).toHaveTextContent(
      'All statuses',
    );

    rerender(<FilterBar filters={[period('7d'), status('open')]} />);
    expect(screen.getByRole('button', { name: 'Period: Last 7 days' })).toHaveTextContent(
      'Last 7 days',
    );
    expect(screen.getAllByText(/Last 7 days/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Status: Open' })).toHaveAttribute('data-active');
  });
});

describe('Pager', () => {
  it('steps page numbers and hides when there is nowhere to go', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pager
        range={{ from: 1, to: 10, total: 12, noun: 'prompts' }}
        {...pageNumberControls(1, 2, onPageChange)}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1–10 of 12 prompts');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <Pager
        hideWhenSinglePage
        canPrev={false}
        canNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('StateBlock', () => {
  it('states an inline absence as one line with its one action', () => {
    render(
      <StateBlock kind="empty" inline message="No rules yet." action={<Button>Add rule</Button>} />,
    );
    expect(screen.getByText('No rules yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
  });

  it('announces loading only after the delay, then reports a failed read with its retry', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<StateBlock kind="loading" label="Loading issues…" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading issues…' })).toBeInTheDocument();

    rerender(
      <StateBlock
        kind="error"
        error={new ApiError('Temporarily unavailable', 503, '')}
        title="Couldn't load the issues"
        fallback="The request failed or timed out."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Couldn't load the issues")).toBeVisible();
    expect(screen.getByText('The request failed or timed out.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps a shown spinner when the next owner of the same wait takes over', async () => {
    const { rerender } = render(<StateBlock key="shell" kind="loading" label="Loading shell…" />);
    expect(await screen.findByRole('status', { name: 'Loading shell…' })).toBeInTheDocument();

    rerender(<StateBlock key="page" kind="loading" label="Loading page…" />);
    expect(screen.getByRole('status', { name: 'Loading page…' })).toBeInTheDocument();

    rerender(<p>Loaded</p>);
    rerender(<StateBlock key="section" kind="loading" label="Loading section…" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading section…' })).toBeInTheDocument();
  });

  it('states a first-use absence with its heading and one action', () => {
    render(
      <StateBlock
        kind="empty"
        icon={Inbox}
        heading="No issues yet"
        description="Run a crawl to find issues."
        action={<Button>Run crawl</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No issues yet' })).toBeVisible();
    expect(screen.getByText('Run a crawl to find issues.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run crawl' })).toBeVisible();
  });

  it('heads an empty state inside a card one rung under the page, unless told otherwise', () => {
    render(
      <>
        <Section>
          <StateBlock kind="empty" icon={Inbox} heading="No mentions yet" />
        </Section>
        <Section>
          <StateBlock kind="empty" icon={Inbox} heading="No sources yet" headingLevel={2} />
        </Section>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'No mentions yet' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'No sources yet' }).tagName).toBe('H2');
  });

  it('says a compact absence in one line with its action and no heading', () => {
    render(
      <StateBlock
        kind="empty"
        inline
        compact
        message="No competitors tracked."
        action={<Button>Add competitor</Button>}
      />,
    );
    expect(screen.getByText('No competitors tracked.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add competitor' })).toBeVisible();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('Avatar', () => {
  it('shows the initials but stays out of the accessibility tree', () => {
    render(<Avatar name="test.user@example.test" />);
    expect(screen.getByText('TE')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
