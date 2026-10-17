import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Avatar } from './avatar';
import { Button } from './button';
import { Card, CardHeader, CardTitle } from './card';
import { LegendSwatch } from './chart';
import { Delta } from './delta';
import { FilterRow, FilterTrigger } from './filter-row';
import { InlineEmpty } from './inline-empty';
import { Meter } from './meter';
import { NoProjectState } from './no-project-state';
import { Pager, pageNumberControls } from './pager';
import { StatGrid, StatItem } from './stat-grid';
import { SortableTableHead, Table, TableHeader, TableRow } from './table';
import { TextLink } from './text-link';
import { TooltipProvider } from './tooltip';

describe('CardHeader actions', () => {
  it('keeps the actions in the header beside the title', () => {
    render(
      <Card aria-label="Issues">
        <CardHeader actions={<Button size="sm">Export</Button>}>
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
  it('signs the rounded change, tones it by policy and never fakes a zero', () => {
    const { rerender } = render(<Delta value={-1.24} unit=" pp" policy="lower-is-better" />);
    const fall = screen.getByText('−1.2 pp').closest('[data-direction]');
    expect(fall).toHaveAttribute('data-direction', 'down');
    // A falling rank is an improvement under lower-is-better.
    expect(fall).toHaveAttribute('data-outcome', 'improved');

    // +0.04 rounds to a displayed 0.0: flat, unsigned.
    rerender(<Delta value={0.04} />);
    expect(screen.getByText('0.0').closest('[data-direction]')).toHaveAttribute(
      'data-direction',
      'flat',
    );

    rerender(
      <TooltipProvider>
        <Delta value={null} missingReason="No comparable run" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Not measured' })).toBeInTheDocument();
  });
});

describe('StatGrid', () => {
  it('names a missing value and makes a pressable stat a keyboard toggle', () => {
    const onSelect = vi.fn();
    render(
      <StatGrid label="Delivery" items={[{ key: 'ttfb', label: 'TTFB', value: null }]}>
        <StatItem
          label="Orphaned pages"
          value={3}
          actionLabel="View 3 orphaned pages"
          onSelect={onSelect}
          selected={false}
        />
      </StatGrid>,
    );
    expect(screen.getByText('TTFB').closest('div')).toHaveTextContent('Not measured');
    const toggle = screen.getByRole('button', { name: 'View 3 orphaned pages' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('Meter', () => {
  it('exposes a clamped value and spoken text by kind', () => {
    const { rerender } = render(<Meter label="Prompt runs usage" value={60} max={50} />);
    const meter = screen.getByRole('meter', { name: 'Prompt runs usage' });
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    expect(meter).toHaveAttribute('aria-valuetext', '50 of 50');

    rerender(<Meter label="Run progress" value={40} kind="progress" tone="info" />);
    expect(screen.getByRole('progressbar', { name: 'Run progress' })).toHaveAttribute(
      'aria-valuetext',
      '40%',
    );
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

  it('routes a back link through the router', () => {
    render(
      <MemoryRouter>
        <TextLink variant="back" href="/runs">
          Back to runs
        </TextLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to runs' })).toHaveAttribute('href', '/runs');
  });
});

describe('FilterRow and FilterTrigger', () => {
  it('names the trigger by its visible value and announces the active count', () => {
    render(
      <FilterRow actions={<Button size="sm">Export</Button>}>
        <FilterTrigger label="Surface" value="ChatGPT" hideLabel active />
        <FilterTrigger label="Filter" count={2} />
      </FilterRow>,
    );
    expect(screen.getByRole('button', { name: 'Surface: ChatGPT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filter\W+2 active$/ })).toBeInTheDocument();
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
    expect(screen.getByText('prompts', { exact: false })).toHaveTextContent('1–10 of 12 prompts');
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

describe('InlineEmpty', () => {
  it('states the absence with its one action', () => {
    render(<InlineEmpty action={<Button size="sm">Add rule</Button>}>No rules yet.</InlineEmpty>);
    expect(screen.getByText('No rules yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
  });
});

describe('NoProjectState', () => {
  it('offers project creation only when the caller allows it', () => {
    const { rerender } = render(
      <MemoryRouter>
        <NoProjectState createProjectHref="/onboarding?new=1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'No project selected' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute(
      'href',
      '/onboarding?new=1',
    );

    rerender(
      <MemoryRouter>
        <NoProjectState createProjectHref={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Select a project first.')).toBeInTheDocument();
  });
});

describe('LegendSwatch', () => {
  it('is decorative so the legend text alone names the series', () => {
    render(
      <p>
        <LegendSwatch tone={{ series: 2 }} />
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
