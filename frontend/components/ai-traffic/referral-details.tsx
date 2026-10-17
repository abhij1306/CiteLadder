import type { AiReferrals } from '@/lib/api/ai-traffic';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert } from '@/components/ui/alert';
import { formatCount, formatPercent } from '@/lib/format';
import { aiSourceLabel } from '@/lib/ai-traffic/series';
import { reasonLabel } from '@/lib/ai-traffic/vocabulary';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { TrafficUrlButton } from './url-panel';

export function ReferralComparison({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Property-wide channel comparison</CardTitle>
        <CardDescription>
          GA4 sessions, engagement rate and key events as configured in your property.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead numeric>Sessions</TableHead>
              <TableHead numeric>Engagement rate</TableHead>
              <TableHead numeric>Key events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
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
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
export function ReferralLandingPages({ data }: Readonly<{ data: AiReferrals }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI referral landing pages</CardTitle>
        <CardDescription>
          Host-scoped path identities · {data.reporting_timezone ?? 'Timezone unavailable'} ·{' '}
          {data.unattributed_landing === null
            ? 'Unattributed landing sessions unavailable.'
            : `${formatCount(data.unattributed_landing)} unattributed landing sessions.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data.landing_pages.length ? (
          <Alert tone="info">
            No identifiable AI referrals to joinable landing paths were observed in the saved
            report.
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Landing path</TableHead>
                <TableHead>Source</TableHead>
                <TableHead numeric>Sessions</TableHead>
                <TableHead numeric>Key events</TableHead>
                <TableHead>Quality</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.landing_pages.map((r) => (
                <TableRow key={r.url_hash + r.ai_source}>
                  <TableCell>
                    <TrafficUrlButton
                      urlHash={r.url_hash}
                      filters={{ start_date: data.window_start, end_date: data.window_end }}
                    >
                      <ClampText lines={1} className="max-w-72">
                        {new URL(r.canonical_url).pathname}
                      </ClampText>
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
