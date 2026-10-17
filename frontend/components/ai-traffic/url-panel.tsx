'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import type { trafficLegSchema, aiTrafficUrlSchema } from '@citeladder/contracts/ai-traffic';
import { Drawer } from '@/components/ui/drawer';
import { Pressable } from '@/components/ui/pressable';
import { MISSING_MARK } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { ReadError } from '@/components/ui/read-error';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { DisplayTime } from '@/components/ui/display-time';
import { PageLoading } from '@/components/layout/page-loading';
import { aiTrafficApi, type TrafficFilters } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';
import { useProjectContext } from '@/lib/project/project-context';
import { projectDestination } from '@/lib/navigation/project-destination';
import { aiSourceLabel } from '@/lib/ai-traffic/series';
import { coverageLabel, legStateLabel, reasonLabel, words } from '@/lib/ai-traffic/vocabulary';

export function TrafficLeg({
  leg,
  unit,
  compact = false,
}: Readonly<{ leg: z.infer<typeof trafficLegSchema>; unit: string; compact?: boolean }>) {
  if (compact) return <CompactTrafficLeg leg={leg} unit={unit} />;
  return (
    <span>
      {leg.value === null ? 'Unavailable' : leg.value} {unit} · {legStateLabel(leg.state)}
      {leg.coverage ? ' · ' + coverageLabel(leg.coverage) : ''}
      {leg.reason ? ' · ' + reasonLabel(leg.reason) : ''}
    </span>
  );
}
function CompactTrafficLeg({
  leg,
  unit,
}: Readonly<{ leg: z.infer<typeof trafficLegSchema>; unit: string }>) {
  const detail = trafficLegExplanation(leg, unit);
  const qualified =
    leg.value === null ||
    !['value', 'zero'].includes(leg.state) ||
    Boolean(leg.reason) ||
    Boolean(leg.coverage && leg.coverage !== 'complete');
  const value = (
    <>
      {leg.value ?? MISSING_MARK}
      {leg.value !== null && leg.coverage === 'partial' ? (
        <span className="type-caption block">Partial</span>
      ) : null}
    </>
  );
  return qualified ? (
    <TooltipProvider>
      <Tooltip content={detail}>
        <Pressable
          type="button"
          className="w-auto text-center tabular-nums"
          aria-label={`${leg.value ?? 'Unavailable'} ${unit}`}
        >
          {value}
        </Pressable>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <span className="tabular-nums">{value}</span>
  );
}
export function UrlPanel({
  urlHash,
  onClose,
  filters = {},
}: Readonly<{ urlHash: string | null; onClose: () => void; filters?: TrafficFilters }>) {
  const { activeProject } = useProjectContext(),
    workspaceId = activeProject?.workspace_id ?? '',
    projectId = activeProject?.id ?? '';
  const query = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'url', { urlHash, ...filters }),
    queryFn: ({ signal }) =>
      aiTrafficApi.url(projectId, urlHash!, filters, { workspaceId, signal }),
    enabled: !!urlHash && !!workspaceId && !!projectId,
  });
  const catalog = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'catalog'),
    queryFn: ({ signal }) => aiTrafficApi.catalog(projectId, { workspaceId, signal }),
    enabled: !!urlHash && !!workspaceId && !!projectId,
  });
  const botLabel = (botId: string) =>
    catalog.data?.bots.find((bot) => bot.bot_id === botId)?.label ?? words(botId);
  const data = query.isError ? undefined : query.data,
    page = data?.page;
  return (
    <Drawer
      open={!!urlHash}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={page?.display_path ?? 'Path-level AI Traffic'}
      description="Persisted observations; requests, sessions and citations are separate units."
    >
      {query.isLoading ? <PageLoading label="Loading URL evidence…" /> : null}
      {query.isError ? (
        <ReadError
          error={query.error}
          fallback="Could not read URL evidence"
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? <UrlEvidence data={data} projectId={projectId} botLabel={botLabel} /> : null}
    </Drawer>
  );
}
function UrlEvidence({
  data,
  projectId,
  botLabel,
}: Readonly<{
  data: z.infer<typeof aiTrafficUrlSchema>;
  projectId: string;
  botLabel: (botId: string) => string;
}>) {
  const page = data.page;
  if (!page)
    return (
      <Alert tone="info">
        No joinable evidence is available for this path in the selected window.
      </Alert>
    );
  const link = (tab: string) =>
    projectDestination('/ai-traffic', new URLSearchParams({ tab }), projectId);
  return (
    <div className="grid gap-4">
      <p className="type-caption">
        {data.window_start} – {data.window_end} · Path-level identity
      </p>
      <p>
        <TrafficLeg leg={page.crawl} unit="requests" /> <Link to={link('crawlers')}>Crawlers</Link>
      </p>
      <p>
        <TrafficLeg leg={page.referrals} unit="AI referral sessions" />{' '}
        <Link to={link('referrals')}>Referrals</Link>
      </p>
      <p>{page.key_events ?? 'Unavailable'} key events as configured in GA4</p>
      <p>
        <TrafficLeg leg={page.citations} unit="tracked citations" />{' '}
        <Link to={projectDestination('/visibility', null, projectId)}>Visibility</Link>
      </p>
      <p>
        <TrafficLeg leg={page.findings} unit="open Site Health findings" />{' '}
        <Link to={projectDestination('/site', null, projectId)}>Site Health</Link>
      </p>
      <p className="type-caption">First and last observations in this window</p>
      {data.crawls.map((r) => (
        <p key={r.bot_id}>
          {botLabel(r.bot_id)}: {r.requests} requests · <DisplayTime value={r.first_seen} /> –{' '}
          <DisplayTime value={r.last_seen} />
        </p>
      ))}
      {data.referrals.map((r) => (
        <p key={r.ai_source}>
          {aiSourceLabel(r.ai_source)}: first referral {r.first_referral} · {r.sessions} sessions
        </p>
      ))}
      {data.citations.map((r) => (
        <p key={r.citation_id}>Tracked citation: {r.date}</p>
      ))}
      {data.provenance.bounded ? (
        <Alert tone="info">The timeline reached its display bound.</Alert>
      ) : null}
      <p className="type-caption">
        Timeline uses saved crawler rollups, GA4 metric rows and tracked citations.
        {data.provenance.crawl_id ? (
          <Link to={projectDestination('/site', null, projectId)}>View Site Health inventory</Link>
        ) : (
          ' Inventory unavailable'
        )}
      </p>
    </div>
  );
}
export function TrafficUrlButton({
  urlHash,
  filters = {},
  label,
  children = 'View AI Traffic',
}: Readonly<{
  urlHash: string;
  filters?: TrafficFilters;
  /** An accessible name when the visible text alone does not identify the page. */
  label?: string;
  children?: React.ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={label}>
        {children}
      </Button>
      <UrlPanel urlHash={open ? urlHash : null} onClose={() => setOpen(false)} filters={filters} />
    </>
  );
}
export function trafficLegExplanation(leg: z.infer<typeof trafficLegSchema>, unit: string) {
  return [
    `${unit}: ${legStateLabel(leg.state)}`,
    leg.coverage && coverageLabel(leg.coverage),
    leg.reason && reasonLabel(leg.reason),
  ]
    .filter(Boolean)
    .join(' · ');
}
