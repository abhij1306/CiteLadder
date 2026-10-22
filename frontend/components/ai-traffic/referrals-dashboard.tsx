import { SearchX } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { TableCell, TableRow } from '@/components/ui/table';
import { TrendChart, type TrendPoint } from '@/components/ui/trend-chart';
import type { AiReferrals } from '@/lib/api/ai-traffic';
import {
  aiSourceLabel,
  countDomainMax,
  toCountChartPoints,
  toPercentChartPoints,
  totalSourceSessions,
} from '@/lib/ai-traffic/series';
import { bucketCountLabel } from '@/lib/ai-traffic/options';
import { formatCount, formatPercent, formatWindowDate } from '@/lib/format';
import { useState } from 'react';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import {
  formatRevenue,
  Measure,
  ReferralComparison,
  ReferralLandingPages,
  ReferralQuality,
} from './referral-details';

export function AiReferralsDashboard({
  data,
  fetching,
}: Readonly<{ data: AiReferrals; fetching: boolean }>) {
  const [tab, setTab] = useState('overview');
  return (
    <Stack gap="workspace" aria-busy={fetching}>
      <ReferralQuality data={data} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        ariaLabel="Referral views"
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'sources', label: 'Sources' },
          { value: 'landing', label: 'Landing pages' },
        ]}
      >
        <TabPanel value="overview">
          <Stack gap="workspace" className="desktop:grid-cols-2">
            <ReferralVolumeCard data={data} />
            <ReferralShareCard data={data} />
          </Stack>
          <ReferralComparison data={data} />
        </TabPanel>
        <TabPanel value="sources">
          <SourceTotals data={data} />
        </TabPanel>
        <TabPanel value="landing">
          <ReferralLandingPages data={data} />
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

/**
 * A referral trend in a card: the series on the chart's own axes (dates
 * under the plot, the scale in its gutter), so no hand-placed labels drift
 * from the line they name.
 */
function TrendCard({
  title,
  description,
  badge,
  points,
  unit,
  domainMax,
  formatTick,
}: Readonly<{
  title: string;
  description: string;
  badge: string;
  points: TrendPoint[];
  /** The y axis's title. */
  unit: string;
  domainMax?: number;
  formatTick?: (value: number) => string;
}>) {
  return (
    <Card>
      <CardHeader actions={<span className="type-caption">{badge}</span>}>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <TrendChart
          label={title}
          data={points}
          width={360}
          height={160}
          domainMax={domainMax}
          xAxisLabel="Date"
          yAxisLabel={unit}
          formatTick={formatTick}
          className="h-auto w-full"
        />
      </CardContent>
    </Card>
  );
}

function ReferralVolumeCard({ data }: Readonly<{ data: AiReferrals }>) {
  const values = data.referral_volume.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  return (
    <TrendCard
      title="AI-referred sessions"
      description="GA4 sessions whose source matches a known AI assistant"
      badge={bucketCountLabel(data.granularity, data.referral_volume.length)}
      points={toCountChartPoints(data.referral_volume)}
      unit="Sessions"
      domainMax={countDomainMax(values)}
    />
  );
}

function ReferralShareCard({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <TrendCard
      title="Share of GA4 sessions"
      description="AI-referred sessions divided by all sessions in the same GA4 source report"
      badge={bucketCountLabel(data.granularity, data.referral_share.length)}
      points={toPercentChartPoints(data.referral_share)}
      unit="Share"
      formatTick={(value) => `${Math.round(value)}%`}
    />
  );
}

function SourceTotals({ data }: Readonly<{ data: AiReferrals }>) {
  const total = totalSourceSessions(data.sources);
  const measured = data.referral_volume.some((point) => point.value !== null);
  return (
    <DataTable
      title="AI referral sources"
      description={
        <>
          {formatCount(total)} identified sessions for {formatWindowDate(data.window_start)} –{' '}
          {formatWindowDate(data.window_end)}. Shares use all GA4 source-report sessions as the
          denominator.
        </>
      }
      columns={sourceColumns(data.currency_code)}
      minWidth="lg"
      state={
        data.sources.length
          ? undefined
          : {
              kind: 'empty',
              icon: SearchX,
              heading: measured
                ? 'GA4 data was measured, but no sessions matched a known AI source in this window.'
                : 'AI-referral classification is not complete for this window, so source totals are unavailable.',
            }
      }
    >
      <SourceTotalsRows data={data} />
    </DataTable>
  );
}

function sourceColumns(currency: string | null): DataTableColumn[] {
  return [
    { key: 'source', label: 'Source' },
    { key: 'sessions', label: 'Sessions', width: 'figure', numeric: true },
    { key: 'share', label: 'Share of GA4 sessions', width: 'metric', numeric: true },
    { key: 'engagement', label: 'Engagement rate', width: 'metric', numeric: true },
    { key: 'key-events', label: 'Key events', width: 'figure', numeric: true },
    { key: 'transactions', label: 'Transactions', width: 'figure', numeric: true },
    {
      key: 'revenue',
      label: `Purchase revenue (${currency ?? 'currency unavailable'})`,
      width: 'metric',
      numeric: true,
    },
  ];
}

function SourceTotalsRows({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <>
      {data.sources.map((source) => {
        const measures = data.source_measures.find((r) => r.ai_source === source.ai_source);
        return (
          <TableRow key={source.ai_source}>
            <TableCell>{aiSourceLabel(source.ai_source)}</TableCell>
            <TableCell numeric>{formatCount(source.sessions)}</TableCell>
            <TableCell numeric>
              <Measure value={source.share} format={(v) => formatPercent(v, 1)} />
            </TableCell>
            <TableCell numeric>
              <Measure
                value={measures?.engagement_rate ?? null}
                format={(v) => formatPercent(v, 1)}
              />
            </TableCell>
            <TableCell numeric>
              <Measure value={measures?.key_events ?? null} format={formatCount} />
            </TableCell>
            <TableCell numeric>
              <Measure value={measures?.transactions ?? null} format={formatCount} />
            </TableCell>
            <TableCell numeric>
              <Measure
                value={measures?.purchase_revenue ?? null}
                format={(v) => formatRevenue(v, data.currency_code)}
              />
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
