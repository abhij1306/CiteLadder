import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { Alert } from './alert';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Field } from './field';
import { Input } from './input';
import { ScoreBar } from './score-bar';
import { ScoreRing } from './score-ring';
import { Skeleton } from './skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRecordMetricCell,
  TableRow,
} from './table';
import { TrendChart } from './trend-chart';
import { scoreBand } from './score-band';

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

  it('labels numeric values when a table becomes mobile records', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableRecordMetricCell label="Coverage">82%</TableRecordMetricCell>
          </tr>
        </tbody>
      </table>,
    );

    const cell = screen.getByRole('cell', { name: '82%' });
    expect(cell).toHaveAttribute('data-label', 'Coverage');
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

describe('Alert', () => {
  it('announces feedback in an alert region', () => {
    render(<Alert tone="danger">Something failed</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something failed');
  });
});

describe('Skeleton', () => {
  it('hides loading decoration from assistive technology', () => {
    render(<Skeleton data-testid="loading-placeholder" />);
    const el = screen.getByTestId('loading-placeholder');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('scoreBand mapping', () => {
  it('maps values to the four bands', () => {
    expect(scoreBand(10)).toBe('low');
    expect(scoreBand(30)).toBe('mid');
    expect(scoreBand(60)).toBe('good');
    expect(scoreBand(90)).toBe('high');
  });
});

describe('ScoreRing', () => {
  it('announces the score and renders its value', () => {
    render(<ScoreRing value={82} />);
    const ring = screen.getByRole('img', { name: 'Visibility score: 82%' });
    expect(ring).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('clamps out-of-range values', () => {
    render(<ScoreRing value={140} label="Overflow" />);
    expect(screen.getByRole('img', { name: 'Overflow' })).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('announces the score once, not again through its numeral', () => {
    render(<ScoreRing value={82} />);
    const numeral = screen.getByText('82');
    expect(numeral).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'Visibility score: 82%' })).toBeInTheDocument();
  });
});

describe('ScoreBar', () => {
  it('renders a clamped accessible meter', () => {
    render(<ScoreBar value={140} label="Readiness score" />);
    const meter = screen.getByRole('meter', { name: 'Readiness score' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '100 out of 100');
  });
});

describe('TrendChart (cross-run Visibility trend)', () => {
  it('renders with an ARIA label describing the trend', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 70 },
        ]}
      />,
    );
    const chart = screen.getByRole('img', {
      name: 'Visibility trend: Trend from Jun (40) to Jul (70)',
    });
    expect(chart).toBeInTheDocument();
  });

  it('renders a single point without a misleading slope or area', () => {
    render(<TrendChart label="Visibility trend" data={[{ label: 'Jul', value: 55 }]} />);
    const chart = screen.getByRole('img', {
      name: 'Visibility trend: Single point Jul (55)',
    });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector(':scope > path')).toBeNull();
    expect(chart.querySelectorAll(':scope > circle')).toHaveLength(1);
  });

  it('draws no axes, ticks or gridlines unless an axis is named', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 70 },
        ]}
      />,
    );
    const chart = screen.getByRole('img', { name: /Visibility trend/ });
    expect(chart.querySelector('text')).toBeNull();
    expect(chart.querySelector('line')).toBeNull();
  });

  it('labels both axes and scales the y ticks to the domain', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: '1 Jun', value: 40 },
          { label: '1 Jul', value: 55 },
          { label: '1 Aug', value: 70 },
        ]}
        xAxisLabel="Run date"
        yAxisLabel="Visibility"
        formatTick={(value) => `${Math.round(value)}%`}
      />,
    );
    const chart = screen.getByRole('img', { name: /Visibility trend/ });
    const text = [...chart.querySelectorAll('text')].map((node) => node.textContent);
    expect(text).toContain('Run date');
    expect(text).toContain('Visibility');
    // Floor, midpoint and ceiling of the 0–100 domain.
    expect(text).toContain('0%');
    expect(text).toContain('50%');
    expect(text).toContain('100%');
    // First, middle and last point, so a reader can place the x positions.
    expect(text).toContain('1 Jun');
    expect(text).toContain('1 Jul');
    expect(text).toContain('1 Aug');
  });

  it('ticks the x axis with the short label, not the full point description', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: '1 Jun 2026 · 40%', axisLabel: '1 Jun', value: 40 },
          { label: '1 Jul 2026 · 70%', axisLabel: '1 Jul', value: 70 },
        ]}
        xAxisLabel="Run date"
        yAxisLabel="Visibility"
      />,
    );
    const chart = screen.getByRole('img', { name: /Visibility trend/ });
    const text = [...chart.querySelectorAll('text')].map((node) => node.textContent);
    expect(text).toContain('1 Jun');
    expect(text).not.toContain('1 Jun 2026 · 40%');
  });

  it('renders an empty state with no data points', () => {
    render(<TrendChart label="Visibility trend" data={[]} />);
    expect(
      screen.getByRole('img', { name: 'Visibility trend: No trend data' }),
    ).toBeInTheDocument();
  });

  it('marks events inside the plotted time span and names them to a screen reader', () => {
    const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
    render(
      <TrendChart
        label="Mention rate"
        data={[
          { label: '1 Mar', value: 40, timestamp: day('2026-03-01') },
          { label: '15 Mar', value: 70, timestamp: day('2026-03-15') },
        ]}
        events={[
          { key: 'inside', timestamp: day('2026-03-05'), label: 'Implemented: reviews page' },
          { key: 'before', timestamp: day('2026-02-01'), label: 'Implemented: old page' },
        ]}
      />,
    );
    const chart = screen.getByRole('img', {
      name: 'Mention rate: Trend from 1 Mar (40) to 15 Mar (70) Marked: Implemented: reviews page.',
    });
    expect(chart.querySelectorAll('[data-event-marker]')).toHaveLength(1);
  });

  it('marks a version boundary with an accessible warning marker', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 70, versionChange: { note: 'Scoring rule scoring-v2 applied' } },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    const marker = chart.querySelector('[data-version-marker]');
    expect(marker).not.toBeNull();
    expect(
      within(chart as unknown as HTMLElement).getByText(/Scoring rule scoring-v2 applied/),
    ).toBeInTheDocument();
  });

  it('renders null values as gaps, announces them, and never draws a zero dot', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 50 },
          { label: 'Aug', value: null },
          { label: 'Sep', value: 60 },
          { label: 'Oct', value: 70 },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    expect(chart).toHaveAttribute(
      'aria-label',
      'Visibility trend: Trend from Jun (40) to Oct (70) Some points are unavailable and shown as gaps.',
    );
    expect(chart.querySelectorAll(':scope > circle')).toHaveLength(4);
    expect(chart.querySelectorAll(':scope > path')).toHaveLength(2);
  });

  it('announces an unavailable endpoint value as "unavailable"', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: null },
          { label: 'Jul', value: 55 },
        ]}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Visibility trend: Trend from Jun (unavailable) to Jul (55) Some points are unavailable and shown as gaps.',
      }),
    ).toBeInTheDocument();
  });

  it('renders a single available point among nulls as a lone dot (no slope)', () => {
    render(
      <TrendChart
        label="Visibility trend"
        data={[
          { label: 'Jun', value: null },
          { label: 'Jul', value: 55 },
          { label: 'Aug', value: null },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    expect(chart.querySelectorAll(':scope > circle')).toHaveLength(1);
    expect(chart.querySelector(':scope > path')).toBeNull();
  });

  it('scales count metrics against a custom domainMax instead of clamping to 100', () => {
    const data = [
      { label: 'Jun', value: 250 },
      { label: 'Jul', value: 500 },
    ];
    const { unmount } = render(<TrendChart label="Clicks trend" data={data} domainMax={500} />);
    let chart = screen.getByRole('img', {
      name: 'Clicks trend: Trend from Jun (250) to Jul (500)',
    });
    let dots = chart.querySelectorAll(':scope > circle');
    expect(Number(dots[0]?.getAttribute('cy'))).toBeGreaterThan(
      Number(dots[1]?.getAttribute('cy')),
    );
    unmount();

    render(<TrendChart label="Clicks trend" data={data} />);
    chart = screen.getByRole('img', {
      name: 'Clicks trend: Trend from Jun (250) to Jul (500)',
    });
    dots = chart.querySelectorAll(':scope > circle');
    expect(dots[0]!.getAttribute('cy')).toBe(dots[1]!.getAttribute('cy'));
  });
});
