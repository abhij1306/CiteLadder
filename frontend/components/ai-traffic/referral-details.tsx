import { SearchX } from 'lucide-react';

import type { AiReferrals } from '@/lib/api/ai-traffic';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Alert } from '@/components/ui/alert';
import { formatCount, formatPercent } from '@/lib/format';
import { aiSourceLabel } from '@/lib/ai-traffic/series';
import { reasonLabel } from '@/lib/ai-traffic/vocabulary';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { TrafficUrlButton } from './url-panel';

const COMPARISON_COLUMNS: readonly DataTableColumn[] = [
  { key: 'channel', label: 'Channel' },
  { key: 'sessions', label: 'Sessions', width: 'figure', numeric: true },
  { key: 'engagement', label: 'Engagement rate', width: 'metric', numeric: true },
  { key: 'key-events', label: 'Key events', width: 'figure', numeric: true },
];
const LANDING_COLUMNS: readonly DataTableColumn[] = [
  { key: 'path', label: 'Landing path' },
  { key: 'source', label: 'Source', width: 'status' },
  { key: 'sessions', label: 'Sessions', width: 'figure', numeric: true },
  { key: 'key-events', label: 'Key events', width: 'figure', numeric: true },
  { key: 'quality', label: 'Quality' },
];

export function ReferralComparison({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <DataTable
      title="Property-wide channel comparison"
      description="GA4 sessions, engagement rate and key events as configured in your property."
      columns={COMPARISON_COLUMNS}
    >
      {data.channel_comparison.map((r) => (
        <TableRow key={r.channel}>
          <TableCell>{r.channel}</TableCell>
          <TableCell numeric>
            <Measure value={r.sessions} format={formatCount} />
          </TableCell>
          <TableCell numeric>
            <Measure value={r.engagement_rate} format={(v) => formatPercent(v, 1)} />
          </TableCell>
          <TableCell numeric>
            <Measure value={r.key_events} format={formatCount} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
export function ReferralLandingPages({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <DataTable
      title="AI referral landing pages"
      description={
        <>
          Host-scoped path identities · {data.reporting_timezone ?? 'Timezone unavailable'} ·{' '}
          {data.unattributed_landing === null
            ? 'Unattributed landing sessions unavailable.'
            : `${formatCount(data.unattributed_landing)} unattributed landing sessions.`}
        </>
      }
      columns={LANDING_COLUMNS}
      minWidth="md"
      state={
        data.landing_pages.length
          ? undefined
          : {
              kind: 'empty',
              icon: SearchX,
              heading:
                'No identifiable AI referrals to joinable landing paths were observed in the saved report.',
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
  );
}
export function ReferralQuality({ data }: Readonly<{ data: AiReferrals }>) {
  const flags = [
    ...new Set(
      Object.values(data.analytics_quality).flatMap((days) => days.flatMap((d) => d.flags)),
    ),
  ];
  const excluded =
    data.analytics_quality.ga4_landing_daily?.reduce((sum, q) => sum + q.excluded_hosts, 0) ?? 0;
  return (
    <>
      <p className="type-caption">
        Property-wide source report · {data.reporting_timezone ?? 'Timezone unavailable'} ·{' '}
        {excluded} landing rows excluded for out-of-scope hosts.
      </p>
      {flags.length ? (
        <Alert tone="info">
          GA4 quality: {flags.map(reasonLabel).join('; ')}. Missing or flagged observations are
          unavailable.
        </Alert>
      ) : null}
    </>
  );
}
/** One unavailable mark for every missing referral measure. */
export function Measure({
  value,
  format,
}: Readonly<{ value: number | null; format: (value: number) => string }>) {
  if (value === null) return <UnavailableValue state="not_measured" />;
  return <span className="tabular-nums">{format(value)}</span>;
}
export function formatRevenue(value: number, currency: string | null) {
  return currency
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
    : formatCount(value);
}
