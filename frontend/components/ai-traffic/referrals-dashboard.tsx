import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendChart, type TrendPoint } from '@/components/ui/trend-chart';
import type { AiReferrals } from '@/lib/api/ai-traffic';
import {
  aiSourceLabel,
  countDomainMax,
  countYLabels,
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
    <div aria-busy={fetching} className="grid gap-[var(--workspace-gap)]">
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
          <div className="grid gap-[var(--workspace-gap)] lg:grid-cols-2">
            <ReferralVolumeCard data={data} />
            <ReferralShareCard data={data} />
          </div>
          <ReferralComparison data={data} />
        </TabPanel>
        <TabPanel value="sources">
          <SourceTotals data={data} />
        </TabPanel>
        <TabPanel value="landing">
          <ReferralLandingPages data={data} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function TrendCard({
  title,
  description,
  badge,
  points,
  yLabels,
  domainMax,
}: Readonly<{
  title: string;
  description: string;
  badge: string;
  points: TrendPoint[];
  yLabels: string[];
  domainMax?: number;
}>) {
  const firstLabel = points[0]?.label ?? '';
  const lastLabel = points.at(-1)?.label ?? '';
  return (
    <Card>
      <CardHeader actions={<span className="type-caption">{badge}</span>}>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3">
          <div className="type-caption flex flex-col justify-between py-1 tabular-nums" aria-hidden>
            {yLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="grid min-w-0 flex-1 gap-1">
            <TrendChart
              label={title}
              data={points}
              width={680}
              height={145}
              domainMax={domainMax}
              className="h-36 w-full"
            />
            {points.length > 1 ? (
              <div className="type-caption flex justify-between tabular-nums" aria-hidden>
                <span>{firstLabel}</span>
                <span>{lastLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReferralVolumeCard({ data }: Readonly<{ data: AiReferrals }>) {
  const values = data.referral_volume.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  const domainMax = countDomainMax(values);
  return (
    <TrendCard
      title="AI-referred sessions"
      description="GA4 sessions whose source matches a known AI assistant"
      badge={bucketCountLabel(data.granularity, data.referral_volume.length)}
      points={toCountChartPoints(data.referral_volume)}
      yLabels={countYLabels(domainMax)}
      domainMax={domainMax}
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
      yLabels={['100%', '75%', '50%', '25%', '0%']}
    />
  );
}

function SourceTotals({ data }: Readonly<{ data: AiReferrals }>) {
  const total = totalSourceSessions(data.sources);
  const measured = data.referral_volume.some((point) => point.value !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI referral sources</CardTitle>
        <CardDescription>
          {formatCount(total)} identified sessions for {formatWindowDate(data.window_start)} –{' '}
          {formatWindowDate(data.window_end)}. Shares use all GA4 source-report sessions as the
          denominator.
        </CardDescription>
      </CardHeader>
      {data.sources.length ? (
        <SourceTotalsTable data={data} />
      ) : (
        <CardContent>
          <p className={textRole('body')}>
            {measured
              ? 'GA4 data was measured, but no sessions matched a known AI source in this window.'
              : 'AI-referral classification is not complete for this window, so source totals are unavailable.'}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function SourceTotalsTable({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead numeric>Sessions</TableHead>
          <TableHead numeric>Share of GA4 sessions</TableHead>
          <TableHead numeric>Engagement rate</TableHead>
          <TableHead numeric>Key events</TableHead>
          <TableHead numeric>Transactions</TableHead>
          <TableHead numeric>
            Purchase revenue ({data.currency_code ?? 'currency unavailable'})
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.sources.map((source) => {
          const measures = data.source_measures.find((r) => r.ai_source === source.ai_source);
          return (
            <TableRow key={source.ai_source}>
              <TableCell>{aiSourceLabel(source.ai_source)}</TableCell>
              <TableCell numeric>
                <span className="tabular-nums">{formatCount(source.sessions)}</span>
              </TableCell>
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
      </TableBody>
    </Table>
  );
}
