import { fireEvent, render, screen, within } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';

import { Avatar } from './avatar';
import { Button } from './button';
import { Card, CardHeader, CardTitle } from './card';
import { ChartSwatch } from './chart';
import { Delta } from './delta';
import { choiceFilter } from './all-filters';
import { FilterBar, FilterTrigger } from './filter-bar';
import { DataTable } from './data-table';
import { Meter } from './meter';
import { Pager, pageNumberControls } from './pager';
import { QueryState } from './query-state';
import { SearchField } from './search-field';
import { StatRow } from './stat-row';
import { Table, TableCell, TableHeader, TableRow } from './table';
import { SortableTableHead } from './table-heads';
import { SegmentedControl } from './tabs';
import { focusByKeyboard } from '@/test/keyboard-focus';
import { renderWithProviders } from '@/test/render';

import { ArrowLink, TextLink } from './text-link';
import { TooltipProvider } from './tooltip';

describe('CardHeader actions', () => {
  it('keeps the actions in the header beside the title', () => {
    render(
      <Card aria-label="Issues">
        <CardHeader actions={<Button>Export</Button>}>
          <CardTitle>Issues</CardTitle>
        </CardHeader>
      </Card>,
    );
    const header = screen.getByRole('heading', { name: 'Issues' }).closest('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole('button', { name: 'Export' })).toBeVisible();
  });
});

describe('Delta', () => {
  it('says the rounded direction in words, tones it by policy and never fakes a zero', () => {
    const { container, rerender } = render(
      <Delta value={-1.24} unit=" pp" policy="lower-is-better" context="vs last week" />,
    );
    const fall = screen.getByText('1.2 pp').closest('[data-direction]');
    expect(fall?.textContent).toBe('↓down 1.2 ppvs last week');
    // A falling rank is an improvement under lower-is-better.
    expect(fall).toHaveAttribute('data-outcome', 'improved');

    // +0.04 rounds to a displayed 0.0: flat, spoken as no change.
    rerender(<Delta value={0.04} />);
    expect(container.textContent).toBe('→no change 0.0');

    rerender(
      <TooltipProvider>
        <Delta value={null} missingReason="No comparable run" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Not measured' })).toBeInTheDocument();
  });
});

describe('StatRow', () => {
  it('names a missing value, draws a score as a ring and makes a pressable stat a toggle', () => {
    const onSelect = vi.fn();
    render(
      <StatRow
        label="Delivery"
        segments={[
          { key: 'ttfb', label: 'TTFB', value: null },
          { key: 'score', label: 'Crawl', score: { value: 72, label: 'Crawl score' } },
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
    );
    const group = screen.getByRole('group', { name: 'Delivery' });
    expect(within(group).getByText('TTFB').closest('[data-stat-segment]')).toHaveTextContent(
      'Not measured',
    );
    // A score is its ring (decision D8): one image named with the number, no bar.
    expect(within(group).getByRole('img', { name: 'Crawl score: 72 out of 100' })).toBeVisible();
    expect(within(group).queryByRole('meter')).not.toBeInTheDocument();
    const toggle = within(group).getByRole('button', { name: 'View 3 orphaned pages' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('puts a comparison window under the value, its absence named like the value', () => {
    render(
      <StatRow
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
    const [clicks, ctr] = within(group).getAllByText('Previous 28 days');
    expect(clicks?.closest('[data-stat-comparison]')).toHaveTextContent('Previous 28 days980');
    expect(ctr?.closest('[data-stat-comparison]')).toHaveTextContent(
      'Previous 28 days–Not measured',
    );
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'count', label: 'Count', width: 'figure', numeric: true },
  ] as const;

  it('pads a short page to the full page of rows and keeps the header over an empty state', () => {
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
    expect(screen.getByRole('heading', { level: 3, name: 'Runs' })).toBeVisible();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);

    rerender(
      <DataTable
        title="Runs"
        columns={columns}
        pageSize={5}
        state={{ kind: 'empty', icon: Inbox, heading: 'No failed runs', headingLevel: 3 }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'No failed runs' })).toBeVisible();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
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
    const { rerender } = render(<Meter label="Prompt runs" value={60} max={50} />);
    const meter = screen.getByRole('meter', { name: 'Prompt runs' });
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    expect(meter).toHaveAttribute('aria-valuetext', '60 / 50');
    expect(screen.getByText('60 / 50')).toBeVisible();

    rerender(
      <Meter
        label="Prompts tracked"
        value={124}
        max={500}
        valueLabel="124 of 500 prompts"
        hint="New prompts wait at the limit"
      />,
    );
    expect(screen.getByRole('meter', { name: 'Prompts tracked' })).toHaveAttribute(
      'aria-valuetext',
      '124 of 500 prompts',
    );
    expect(screen.getByText('New prompts wait at the limit')).toBeVisible();
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
            {/* An inactive column has no order, whatever its flag says. */}
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
    // The row draws its slots in document order, whatever order a page passes them in.
    const order = [
      screen.getByRole('radiogroup', { name: 'Pages shown' }),
      screen.getByRole('searchbox', { name: 'Search pages' }),
      // A lone filter is its own trigger, named by its value.
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
  it('puts two or more filters behind All filters, counting the changed ones', () => {
    const filter = (id: string, value: string) =>
      choiceFilter({
        id,
        label: id,
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
    render(<FilterBar filters={[filter('Kind', 'one'), filter('Engine', 'all')]} />);
    expect(screen.getByRole('button', { name: 'All filters (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kind: One' })).toBeNull();
  });
  it('names a trigger by its visible value', () => {
    render(<FilterTrigger label="Surface" value="ChatGPT" hideLabel active />);
    expect(screen.getByRole('button', { name: 'Surface: ChatGPT' })).toBeInTheDocument();
  });
  it('sizes a trigger to its options without adding them to its text', () => {
    render(
      <FilterTrigger
        label="Surface"
        value="ChatGPT"
        hideLabel
        sizeTo={['All surfaces', 'ChatGPT', 'Google AI Overviews']}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Surface: ChatGPT' });
    // The longest option is reserved as generated content, never readable text.
    expect(trigger.textContent).toBe('Surface: ChatGPT');
    expect(trigger.querySelector('[data-size="Google AI Overviews"]')).not.toBeNull();
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
    // The range is a polite status, so a page turn is announced.
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

describe('QueryState', () => {
  it('states an inline absence as one line with its one action', () => {
    render(
      <QueryState kind="empty" inline message="No rules yet." action={<Button>Add rule</Button>} />,
    );
    expect(screen.getByText('No rules yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
  });

  it('announces loading only after the delay, then reports a failed read with its retry', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<QueryState kind="loading" label="Loading issues…" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading issues…' })).toBeInTheDocument();

    rerender(
      <QueryState
        kind="error"
        error={new ApiError('Temporarily unavailable', 503, '')}
        fallback="Issues could not be loaded."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Temporarily unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps a shown spinner when the next owner of the same wait takes over', async () => {
    const { rerender } = render(<QueryState key="shell" kind="loading" label="Loading shell…" />);
    expect(await screen.findByRole('status', { name: 'Loading shell…' })).toBeInTheDocument();

    // A different owner's box (a fresh mount) continues the visible wait at once.
    rerender(<QueryState key="page" kind="loading" label="Loading page…" />);
    expect(screen.getByRole('status', { name: 'Loading page…' })).toBeInTheDocument();

    // A wait that starts with nothing showing is still held back.
    rerender(<p>Loaded</p>);
    rerender(<QueryState key="section" kind="loading" label="Loading section…" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading section…' })).toBeInTheDocument();
  });

  it('states a first-use absence with its heading and one action', () => {
    render(
      <QueryState
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
        <Card>
          <QueryState kind="empty" icon={Inbox} heading="No mentions yet" />
        </Card>
        <Card>
          <QueryState kind="empty" icon={Inbox} heading="No sources yet" headingLevel={2} />
        </Card>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'No mentions yet' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'No sources yet' }).tagName).toBe('H2');
  });

  it('says a compact absence in one line with its action and no heading', () => {
    render(
      <QueryState
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

describe('ChartSwatch', () => {
  it('is decorative so the legend text alone names the series', () => {
    render(
      <p>
        <ChartSwatch tone={2} />
        Competitors
      </p>,
    );
    expect(screen.getByText('Competitors').firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('Avatar', () => {
  it('shows the initials but stays out of the accessibility tree', () => {
    render(<Avatar name="test.user@example.test" />);
    expect(screen.getByText('TE')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
