import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { AppGrid } from '@/components/ui/app-grid';
import { TableCell, TableRow } from '@/components/ui/table';
import { AreaChart } from '@/components/ui/area-chart';
import { type TrendPoint } from '@/components/ui/series-data';
import { SearchX } from '@/lib/icons';
import type { AiReferrals } from '@/lib/api/ai-traffic';
import {
  aiSourceLabel,
  countDomainMax,
  toCountChartPoints,
  toPercentChartPoints,
  totalSourceSessions,
} from '@/lib/ai-traffic/series';
import { bucketCountLabel } from '@/lib/ai-traffic/options';
import { formatAmount, formatCount, formatPercent, formatWindowDate } from '@/lib/format';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import {
  Measure,
  ReferralComparison,
  ReferralLandingPages,
  ReferralQuality,
} from './referral-details';
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionStack,
  SectionTitle,
  TitledSection,
} from '@/components/ui/section';

const REFERRAL_VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'sources', label: 'Sources' },
  { value: 'landing', label: 'Landing pages' },
] as const;
type ReferralView = (typeof REFERRAL_VIEWS)[number]['value'];
const viewCodec = stringUrlCodec<ReferralView>(
  REFERRAL_VIEWS.map((view) => view.value),
  'overview',
);

export function AiReferralsDashboard({
  data,
  fetching,
}: Readonly<{ data: AiReferrals; fetching: boolean }>) {
  const [tab, setTab] = useUrlState('referrals_view', viewCodec);
  return (
    <SectionStack aria-busy={fetching}>
      <ReferralQuality data={data} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        ariaLabel="Referral views"
        spaced
        items={REFERRAL_VIEWS}
      >
        <TabPanel value="overview">
          <SectionStack>
            <AppGrid layout="halves">
              <ReferralVolumeCard data={data} />
              <ReferralShareCard data={data} />
            </AppGrid>
            <ReferralComparison data={data} />
          </SectionStack>
        </TabPanel>
        <TabPanel value="sources">
          <SourceTotals data={data} />
        </TabPanel>
        <TabPanel value="landing">
          <ReferralLandingPages data={data} />
        </TabPanel>
      </Tabs>
    </SectionStack>
  );
}

function TrendCard({
  title,
  badge,
  points,
  unit,
  domainMax,
  formatTick,
}: Readonly<{
  title: string;
  badge: string;
  points: TrendPoint[];
  unit: string;
  domainMax?: number;
  formatTick?: (value: number) => string;
}>) {
  return (
    <Section>
      <SectionHeader actions={<span className="type-caption">{badge}</span>}>
        <SectionTitle>{title}</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <AreaChart
          label={title}
          name={unit}
          data={points}
          height="sm"
          yMax={domainMax}
          yFormat={formatTick}
          you={false}
        />
      </SectionContent>
    </Section>
  );
}

function ReferralVolumeCard({ data }: Readonly<{ data: AiReferrals }>) {
  const values = data.referral_volume.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  return (
    <TrendCard
      title="AI-referred sessions"
      badge={bucketCountLabel(data.granularity, data.referral_volume.length)}
      points={toCountChartPoints(data.referral_volume, {
        granularity: data.granularity,
        windowEnd: data.window_end,
      })}
      unit="Sessions"
      domainMax={countDomainMax(values)}
    />
  );
}

function ReferralShareCard({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <TrendCard
      title="Share of GA4 sessions"
      badge={bucketCountLabel(data.granularity, data.referral_share.length)}
      points={toPercentChartPoints(data.referral_share, {
        granularity: data.granularity,
        windowEnd: data.window_end,
      })}
      unit="Share"
      formatTick={(value) => `${Math.round(value)}%`}
    />
  );
}

function SourceTotals({ data }: Readonly<{ data: AiReferrals }>) {
  const total = totalSourceSessions(data.sources);
  const measured = data.referral_volume.some((point) => point.value !== null);
  return (
    <TitledSection
      title="AI referral sources"
      description={
        <>
          {formatCount(total)} identified sessions
          {data.window_start && data.window_end
            ? ` · ${formatWindowDate(data.window_start)} – ${formatWindowDate(data.window_end)}`
            : ''}
        </>
      }
    >
      <DataTable
        label="AI referral sources"
        columns={sourceColumns(data.currency_code)}
        state={
          data.sources.length
            ? undefined
            : {
                kind: 'empty',
                icon: SearchX,
                heading: measured
                  ? 'No sessions matched a known AI source in this window'
                  : 'Source totals unavailable: classification is not complete for this window',
              }
        }
      >
        <SourceTotalsRows data={data} />
      </DataTable>
    </TitledSection>
  );
}

function sourceColumns(currency: string | null): DataTableColumn[] {
  return [
    { key: 'source', label: 'Source' },
    { key: 'sessions', label: 'Sessions', width: 'figure', kind: 'number' },
    { key: 'share', label: 'Share of GA4 sessions', width: 'metric', kind: 'number' },
    { key: 'engagement', label: 'Engagement rate', width: 'metric', kind: 'number' },
    { key: 'key-events', label: 'Key events', width: 'figure', kind: 'number' },
    { key: 'transactions', label: 'Transactions', width: 'figure', kind: 'number' },
    {
      key: 'revenue',
      label: `Purchase revenue (${currency ?? 'currency unavailable'})`,
      width: 'metric',
      kind: 'number',
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
              <Measure value={source.share} format={formatPercent} />
            </TableCell>
            <TableCell numeric>
              <Measure value={measures?.engagement_rate ?? null} format={formatPercent} />
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
                format={(v) => formatAmount(v, data.currency_code)}
              />
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
