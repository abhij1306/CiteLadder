import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { Button } from './button';
import { Citation } from './citation';
import { EngineMark } from './engine-mark';
import { Field } from './field';
import { Input } from './input';
import { Kbd } from './kbd';
import { ProgressMeter } from '@/components/ui/progress-meter';
import { BusyRung } from '@/components/ui/rung-meter';
import { Rungs } from './rungs';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { TrendChart } from './trend-chart';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';
import { Select } from '@/components/ui/select';

describe('Button', () => {
  it('defaults to a non-submitting button', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
  });
});

describe('Section', () => {
  it('renders semantic header/title/content slots', () => {
    render(
      <Section data-testid="card">
        <SectionHeader>
          <SectionTitle>Visibility</SectionTitle>
        </SectionHeader>
        <SectionContent>Body</SectionContent>
      </Section>,
    );
    expect(screen.getByText('Visibility').tagName).toBe('H2');
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

  it('says a field is required through the control, not the asterisk', () => {
    render(
      <Field label="Email" required>
        {(fieldProps) => <Input {...fieldProps} />}
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeRequired();
  });

  it('forwards the ref to the native input inside an adorned frame', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Search" startContent={<span>S</span>} />);
    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Search' }));
  });
});

describe('Select', () => {
  it('shows the placeholder for an empty value, and an empty option when one exists', () => {
    const choices = [{ value: 'b2b' as const, label: 'Businesses' }];
    const { rerender } = render(
      <Select<'' | 'b2b'> ariaLabel="Buyer" value="" placeholder="Not set" options={choices} />,
    );
    expect(screen.getByRole('combobox', { name: 'Buyer' })).toHaveTextContent('Not set');
    rerender(
      <Select<'' | 'b2b'>
        ariaLabel="Buyer"
        value=""
        placeholder="Not set"
        options={[{ value: '' as const, label: 'Anyone' }, ...choices]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Buyer' })).toHaveTextContent('Anyone');
  });
});

describe('Skeleton', () => {
  it('draws a table of blocks, never lines, and announces its verb only after the delay', async () => {
    const { container } = render(
      <Skeleton variant="table" columns={4} rows={3} label="Loading prompts" />,
    );
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-skeleton-block]')).toHaveLength(12);
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('status', { name: 'Loading prompts' })).toBeVisible();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('ProgressMeter', () => {
  it('names the bar by its label and speaks its value as a percentage, clamped to 100', () => {
    const { container, rerender } = render(<ProgressMeter label="Progress" value={48} />);
    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    expect(bar).toHaveAttribute('value', '48');
    expect(bar).toHaveAttribute('max', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '48.0%');
    expect(bar).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('48.0%')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.bg-data-you')?.style.width).toBe('48%');

    rerender(<ProgressMeter label="Progress" value={130} />);
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('value', '100');
  });

  it('shows a background refresh only while active', () => {
    const { rerender } = render(<BusyRung active={false} label="Updating usage" />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    rerender(<BusyRung active label="Updating usage" />);
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
    expect(link).toHaveTextContent('2example.comBest running shoes');
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

describe('TrendChart', () => {
  const rows = () =>
    within(screen.getByRole('table', { name: 'Visibility trend' }))
      .getAllByRole('row')
      .map((row) => row.textContent);
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

  it('bridges a break between two measured points with a dashed connector, never a missing value', () => {
    const connectors = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-trend-line="1"] [data-trend-connector]')].map((path) =>
        path.getAttribute('stroke-dasharray'),
      );
    const { container, rerender } = render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 60, breakBefore: true, versionChange: { note: 'New method' } },
        ]}
      />,
    );
    expect(runsOf(container)).toBe(3);
    expect(container.querySelectorAll('[data-trend-line="1"] circle')).toHaveLength(2);
    expect(connectors(container)).toEqual(['3 4']);
    expect(container.querySelectorAll('[data-version-marker]')).toHaveLength(1);

    rerender(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: null },
          { label: 'Aug', value: 60, breakBefore: true },
        ]}
      />,
    );
    expect(connectors(container)).toEqual([]);
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
