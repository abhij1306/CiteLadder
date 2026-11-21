import { SearchX } from '@/lib/icons';
import type { AiReferrals } from '@/lib/api/ai-traffic';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatCount, formatPercent } from '@/lib/format';
import { aiSourceLabel } from '@/lib/ai-traffic/series';
import { reasonLabel } from '@/lib/ai-traffic/vocabulary';
import { Absence } from '@/components/ui/absence';
import { TrafficUrlButton } from './url-panel';
import { Notice } from '@/components/ui/notice';
import { TitledSection } from '@/components/ui/section';

const COMPARISON_COLUMNS: readonly DataTableColumn[] = [
  { key: 'channel', label: 'Channel' },
  { key: 'sessions', label: 'Sessions', width: 'figure', kind: 'number' },
  { key: 'engagement', label: 'Engagement rate', width: 'metric', kind: 'number' },
  { key: 'key-events', label: 'Key events', width: 'figure', kind: 'number' },
];
const LANDING_COLUMNS: readonly DataTableColumn[] = [
  { key: 'path', label: 'Landing path' },
  { key: 'source', label: 'Source', width: 'status' },
  { key: 'sessions', label: 'Sessions', width: 'figure', kind: 'number' },
  { key: 'key-events', label: 'Key events', width: 'figure', kind: 'number' },
  { key: 'quality', label: 'Quality' },
];

export function ReferralComparison({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <TitledSection title="Property-wide channel comparison">
      <DataTable label="Property-wide channel comparison" columns={COMPARISON_COLUMNS}>
        {data.channel_comparison.map((r) => (
          <TableRow key={r.channel}>
            <TableCell>{r.channel}</TableCell>
            <TableCell numeric>
              <Measure value={r.sessions} format={formatCount} />
            </TableCell>
            <TableCell numeric>
              <Measure value={r.engagement_rate} format={formatPercent} />
            </TableCell>
            <TableCell numeric>
              <Measure value={r.key_events} format={formatCount} />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}
export function ReferralLandingPages({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <TitledSection
      title="AI referral landing pages"
      description={
        <>
          {data.reporting_timezone ?? 'Timezone unavailable'} ·{' '}
          {data.unattributed_landing === null
            ? 'Unidentified landing pages: unavailable'
            : `${formatCount(data.unattributed_landing)} sessions with an unidentified landing page`}
        </>
      }
    >
      <DataTable
        label="AI referral landing pages"
        columns={LANDING_COLUMNS}
        state={
          data.landing_pages.length
            ? undefined
            : {
                kind: 'empty',
                icon: SearchX,
                heading: 'No identifiable AI referral landing pages in this report',
              }
        }
      >
        {data.landing_pages.map((r) => (
          <TableRow key={r.url_hash + r.ai_source}>
            <TableCell>
              <TrafficUrlButton
                urlHash={r.url_hash}
                filters={{ start_date: data.window_start, end_date: data.window_end }}
              >
                <ClampText lines={1}>{new URL(r.canonical_url).pathname}</ClampText>
              </TrafficUrlButton>
            </TableCell>
            <TableCell>{aiSourceLabel(r.ai_source)}</TableCell>
            <TableCell numeric>
              <Measure value={r.sessions} format={formatCount} />
            </TableCell>
            <TableCell numeric>
              <Measure value={r.key_events} format={formatCount} />
            </TableCell>
            <TableCell>
              {r.analytics_quality.map(reasonLabel).join('; ') || 'No quality flags'}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}
export function ReferralQuality({ data }: Readonly<{ data: AiReferrals }>) {
  const flags = [
    ...new Set(
      Object.values(data.analytics_quality).flatMap((days) => days.flatMap((d) => d.flags)),
    ),
  ];
  const landingDays = (data.analytics_quality.ga4_landing_daily ?? []).filter(
    (q) => q.revision !== null,
  );
  const excluded = landingDays.length
    ? `${formatCount(landingDays.reduce((sum, q) => sum + q.excluded_hosts, 0))} landing rows excluded for out-of-scope hosts.`
    : 'Landing rows excluded for out-of-scope hosts: not available.';
  return (
    <>
      <p className="type-caption">
        {data.reporting_timezone ?? 'Timezone unavailable'} · {excluded}
      </p>
      {flags.length ? (
        <Notice tone="info">GA4 quality: {flags.map(reasonLabel).join('; ')}.</Notice>
      ) : null}
    </>
  );
}
export function Measure({
  value,
  format,
}: Readonly<{ value: number | null; format: (value: number) => string }>) {
  if (value === null) return <Absence state="not_measured" />;
  return <span className="tabular-nums">{format(value)}</span>;
}
