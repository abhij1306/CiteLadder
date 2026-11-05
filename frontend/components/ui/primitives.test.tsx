import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { Button } from './button';
import { Callout } from './callout';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Citation } from './citation';
import { EmptyState } from './empty-state';
import { EngineMark } from './engine-mark';
import { Field, FormRow } from './field';
import { Input } from './input';
import { Kbd } from './kbd';
import { BusyBar, ProgressBar } from './progress-bar';
import { Rungs } from './rungs';
import { ScoreRing, scoreFill } from './score-ring';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { TrendChart } from './trend-chart';

describe('Button', () => {
  it('defaults to a non-submitting button', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
  });
});

describe('Card', () => {
  it('renders semantic header/title/content slots', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Visibility</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByText('Visibility').tagName).toBe('H3');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});

describe('Table (dense)', () => {
  it('preserves table headers and row values', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Prompt</TableHead>
            <TableHead numeric>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>How good is X?</TableCell>
            <TableCell numeric>82</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Prompt', 'Score']);
    expect(screen.getByRole('cell', { name: 'How good is X?' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '82' })).toBeVisible();

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
  });
});

describe('Input + Field', () => {
  it('wires label to input via generated id, and surfaces errors', () => {
    render(
      <Field label="Email" error="Required">
        {(fieldProps) => <Input placeholder="you@co" {...fieldProps} />}
      </Field>,
    );
    const input = screen.getByPlaceholderText('you@co');
    const label = screen.getByText('Email');
    expect(label).toHaveAttribute('for', input.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('forwards the ref to the native input inside an adorned frame', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Search" startContent={<span>S</span>} />);
    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Search' }));
  });
});

describe('FormRow', () => {
  it('names its control by the row label', () => {
    render(
      <FormRow label="Workspace name" description="Shown on invoices" htmlFor="workspace-name">
        <Input id="workspace-name" />
      </FormRow>,
    );
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeInTheDocument();
    expect(screen.getByText('Shown on invoices')).toBeInTheDocument();
  });
});

describe('Callout', () => {
  it('announces negative and warning callouts as alerts and the rest as status, with the tone word', () => {
    const { rerender } = render(
      <Callout tone="negative" title="Crawl failed">
        The site returned 503.
      </Callout>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Error: Crawl failedThe site returned 503.',
    );

    rerender(<Callout tone="positive">Saved</Callout>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('renders nothing without a title or body', () => {
    const { container } = render(<Callout tone="info" />);
    expect(container).toBeEmptyDOMElement();
    render(<Callout tone="info">Data refreshes nightly</Callout>);
    expect(screen.getByRole('status')).toHaveTextContent('Data refreshes nightly');
  });
});

describe('EmptyState', () => {
  it('names the empty view with a heading at the requested level and offers its actions', () => {
    render(
      <EmptyState
        title="No prompts yet"
        description="Add a prompt to start measuring."
        headingLevel={2}
        primary={<Button variant="primary">Add prompt</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No prompts yet' })).toBeInTheDocument();
    expect(screen.getByText('Add a prompt to start measuring.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add prompt' })).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('announces one busy status by its label while the bars stay hidden', () => {
    render(<Skeleton variant="row" rows={3} label="Loading prompts" />);
    const status = screen.getByRole('status', { name: 'Loading prompts' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('');
  });
});

describe('ProgressBar', () => {
  it('reports its value in the product units and goes busy without one', () => {
    const { rerender } = render(
      <ProgressBar label="Running prompts" value={48} max={120} valueLabel="48 of 120 prompts" />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Running prompts' });
    expect(bar).toHaveAttribute('value', '48');
    expect(bar).toHaveAttribute('max', '120');
    expect(screen.getByText('48 of 120 prompts')).toBeInTheDocument();

    rerender(<ProgressBar label="Running prompts" />);
    const busy = screen.getByRole('progressbar', { name: 'Running prompts' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).not.toHaveAttribute('value');
  });

  it('shows a background refresh only while active', () => {
    const { rerender } = render(<BusyBar active={false} label="Updating usage" />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    rerender(<BusyBar active label="Updating usage" />);
    expect(screen.getByRole('progressbar', { name: 'Updating usage' })).toBeInTheDocument();
  });
});

describe('Kbd', () => {
  it('renders a combination as one key cap per key', () => {
    render(<Kbd keys={['⌘', 'K']} />);
    expect([...document.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['⌘', 'K']);
  });
});

describe('Rungs', () => {
  it('always carries the citation level as words', () => {
    const { rerender } = render(<Rungs level={2} />);
    expect(screen.getByText('Cited')).toHaveClass('sr-only');
    rerender(<Rungs level={3} showLabel />);
    expect(screen.getByText('Top source')).not.toHaveClass('sr-only');
  });
});

describe('Citation', () => {
  it('links to the cited page in a new tab under its footnote and bare domain', () => {
    render(
      <Citation
        index={2}
        domain="www.example.com"
        title="Best running shoes"
        href="https://www.example.com/shoes"
      />,
    );
    const link = screen.getByRole('link', { name: /example\.com/ });
    expect(link).toHaveAttribute('href', 'https://www.example.com/shoes');
    expect(link).toHaveTextContent('2Eexample.comBest running shoes');
  });
});

describe('EngineMark', () => {
  it('draws the named engine as decoration only', () => {
    const { container } = render(<EngineMark engine="claude" />);
    const mark = container.querySelector('svg');
    expect(mark).toHaveAttribute('data-engine-mark', 'claude');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('scoreFill', () => {
  it('keeps one ink, or bands a compared score at 80 and 50', () => {
    expect(scoreFill('ink', 20)).toBe('ink');
    expect(scoreFill('auto', 80)).toBe('positive');
    expect(scoreFill('auto', 79)).toBe('warning');
    expect(scoreFill('auto', 50)).toBe('warning');
    expect(scoreFill('auto', 49)).toBe('negative');
  });
});

describe('ScoreRing', () => {
  it('announces the clamped score once, not again through its numeral', () => {
    render(<ScoreRing value={140} label="Site Health score" />);
    expect(screen.getByRole('img', { name: 'Site Health score: 100 out of 100' })).toBeVisible();
    expect(screen.getByText('100')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('TrendChart', () => {
  const rows = () =>
    within(screen.getByRole('table', { name: 'Visibility trend' }))
      .getAllByRole('row')
      .map((row) => row.textContent);
  /** The drawn runs of the first line: each `M` lifts the pen after a gap. */
  const runsOf = (container: HTMLElement) =>
    container.querySelector('[data-trend-line="1"] path')?.getAttribute('d')?.split('M').length ??
    1;

  it('tabulates every line and value, with a missing value named rather than zero', () => {
    render(
      <TrendChart
        label="Visibility trend"
        name="You"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: null },
        ]}
        series={[{ label: 'Globex', values: [30, 35] }]}
        yFormat={(value) => `${value}%`}
      />,
    );
    expect(rows()).toEqual(['SeriesJunJul', 'You40%Not measured', 'Globex30%35%']);
  });

  it('keys each line with its latest value, and reads any point with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <TrendChart
        label="Visibility trend"
        name="You"
        data={[
          { label: '1 Jun 2026', value: 40 },
          { label: '1 Jul 2026', value: 70 },
        ]}
        yFormat={(value) => `${value}%`}
      />,
    );
    expect(screen.getAllByText('70%').length).toBeGreaterThan(0);

    await user.tab();
    expect(
      screen.getByRole('group', {
        name: 'Visibility trend. Use the left and right arrow keys to read each point.',
      }),
    ).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 Jun 2026', { selector: 'p' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('1 Jun 2026', { selector: 'p' })).toBeNull();
  });

  it('breaks the line at a missing value and at a point measured under changed conditions', () => {
    const { container, rerender } = render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 50 },
          { label: 'Aug', value: 60 },
        ]}
      />,
    );
    expect(runsOf(container)).toBe(2);

    rerender(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: null },
          { label: 'Aug', value: 60, breakBefore: true },
          { label: 'Sep', value: 70 },
        ]}
      />,
    );
    expect(runsOf(container)).toBe(3);
  });

  it('dots a value standing alone between gaps, so it is not drawn as nothing', () => {
    const { container } = render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: null },
          { label: 'Jul', value: 55 },
          { label: 'Aug', value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-trend-line="1"] circle')).toHaveLength(1);
  });

  it('dates the axis with the short label and ticks the scale with the y format', () => {
    const { container } = render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: '1 Jun 2026 · 40%', axisLabel: '1 Jun', value: 40 },
          { label: '1 Jul 2026 · 70%', axisLabel: '1 Jul', value: 70 },
        ]}
        yMax={100}
        yFormat={(value) => `${value}%`}
      />,
    );
    const text = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
    expect(text).toEqual(['0%', '20%', '40%', '60%', '80%', '100%', '1 Jun', '1 Jul']);
  });

  it('marks only the events inside the plotted span, and names method changes and events', () => {
    const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
    const { container } = render(
      <TrendChart
        label="Mention rate"
        data={[
          { label: '1 Mar', value: 40, timestamp: day('2026-03-01') },
          {
            label: '15 Mar',
            value: 70,
            timestamp: day('2026-03-15'),
            versionChange: { note: 'Scoring rule scoring-v2 applied' },
          },
        ]}
        events={[
          { key: 'inside', timestamp: day('2026-03-05'), label: 'Implemented: reviews page' },
          { key: 'before', timestamp: day('2026-02-01'), label: 'Implemented: old page' },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-event-marker]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-version-marker]')).toHaveLength(1);
    expect(
      within(screen.getByRole('list', { name: 'Mention rate: marked' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Method changed at 15 Mar: Scoring rule scoring-v2 applied',
      'Implemented: reviews page',
    ]);
  });
});
