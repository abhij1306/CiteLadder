import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import type { trafficLegSchema, aiTrafficUrlSchema } from '@citeladder/contracts/ai-traffic';
import { Drawer } from '@/components/ui/drawer';
import { Absence } from '@/components/ui/absence';
import { Pressable } from '@/components/ui/pressable';
import { PanelRightOpen } from '@/lib/icons';
import { formatCount, formatWindowDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Stack } from '@/components/ui/layout';
import { Tooltip } from '@/components/ui/tooltip';
import { UrlText } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { DisplayTime } from '@/components/ui/display-time';
import { aiTrafficQueries, type TrafficFilters } from '@/lib/api/ai-traffic';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { projectDestination } from '@/lib/navigation/project-destination';
import { aiSourceLabel } from '@/lib/ai-traffic/series';
import { coverageLabel, legStateLabel, reasonLabel, words } from '@/lib/ai-traffic/vocabulary';
import { READ_FAILED, StateBlock } from '@/components/ui/state-block';
import { FactList } from '@/components/ui/facts';

type Leg = z.infer<typeof trafficLegSchema>;
type UrlEvidenceData = z.infer<typeof aiTrafficUrlSchema>;

export function TrafficLeg({ leg, unit }: Readonly<{ leg: Leg; unit: string }>) {
  const detail = trafficLegExplanation(leg, unit);
  if (leg.value === null) return <LegAbsence leg={leg} reason={detail} />;
  const qualified =
    !['value', 'zero'].includes(leg.state) ||
    Boolean(leg.reason) ||
    Boolean(leg.coverage && leg.coverage !== 'complete');
  return qualified ? (
    <Tooltip content={detail}>
      <Pressable
        type="button"
        className="w-auto text-right tabular-nums"
        aria-label={`${formatCount(leg.value)} ${unit}`}
      >
        {formatCount(leg.value)}
      </Pressable>
    </Tooltip>
  ) : (
    formatCount(leg.value)
  );
}
function LegAbsence({ leg, reason }: Readonly<{ leg: Pick<Leg, 'state'>; reason?: string }>) {
  if (leg.state === 'not_connected') return <Absence state="not_connected" reason={reason} />;
  return (
    <Absence
      state="unavailable"
      label={leg.state === 'unknown' ? 'Unknown' : undefined}
      reason={reason}
    />
  );
}
export function UrlPanel({
  urlHash,
  onClose,
  filters = {},
  fromRow = false,
}: Readonly<{
  urlHash: string | null;
  onClose: () => void;
  filters?: TrafficFilters;
  fromRow?: boolean;
}>) {
  const { workspaceId, projectId } = useProjectScope();
  const query = useQuery(aiTrafficQueries.url({ workspaceId, projectId }, urlHash, filters));
  const catalog = useQuery({
    ...aiTrafficQueries.catalog({ workspaceId, projectId }),
    enabled: !!urlHash,
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
      title={page ? <UrlText url={page.display_path} /> : 'Path-level AI traffic'}
    >
      {query.isLoading ? (
        <StateBlock
          kind="loading"
          label="Loading URL evidence…"
          shape={{ kind: 'facts', rows: 5 }}
        />
      ) : null}
      {query.isError ? (
        <StateBlock
          kind="error"
          error={query.error}
          title="Couldn't load this page's AI traffic"
          fallback={READ_FAILED}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? (
        <UrlEvidence data={data} projectId={projectId} botLabel={botLabel} fromRow={fromRow} />
      ) : null}
    </Drawer>
  );
}

type MetricRow = Readonly<{
  name: string;
  value: ReactNode;
  note?: string | null;
  link?: Readonly<{ label: string; to: string }>;
}>;

function legRow(leg: Leg): Pick<MetricRow, 'value' | 'note'> {
  if (leg.value === null) return { value: <LegAbsence leg={leg} /> };
  const notes = new Set(
    [
      leg.state === 'value' || leg.state === 'zero' ? null : legStateLabel(leg.state),
      leg.coverage && leg.coverage !== 'complete' ? coverageLabel(leg.coverage) : null,
      leg.reason ? reasonLabel(leg.reason) : null,
    ].filter((note) => note !== null),
  );
  return { value: formatCount(leg.value), note: notes.size ? [...notes].join(' · ') : null };
}

function UrlEvidence({
  data,
  projectId,
  botLabel,
  fromRow,
}: Readonly<{
  data: UrlEvidenceData;
  projectId: string;
  botLabel: (botId: string) => string;
  fromRow: boolean;
}>) {
  const page = data.page;
  if (!page)
    return <StateBlock kind="empty" inline message="No evidence for this path in this window." />;
  const tab = (name: string) =>
    projectDestination('/ai-traffic', new URLSearchParams({ tab: name }), projectId);
  const website = projectDestination('/site', null, projectId);
  const rows: readonly MetricRow[] = [
    {
      name: 'Crawler requests',
      ...legRow(page.crawl),
      link: { label: 'Crawlers', to: tab('crawlers') },
    },
    {
      name: 'AI referral sessions',
      ...legRow(page.referrals),
      link: { label: 'Referrals', to: tab('referrals') },
    },
    {
      name: 'Key events (GA4)',
      ...legRow({ ...page.referrals, value: page.key_events }),
    },
    {
      name: 'Tracked citations',
      ...legRow(page.citations),
      link: { label: 'Visibility', to: projectDestination('/visibility', null, projectId) },
    },
    {
      name: 'Open Site health findings',
      ...legRow(page.findings),
      link: { label: 'Site health', to: website },
    },
  ];
  return (
    <Stack gap="workspace">
      <p className={textRole('caption')}>
        {formatWindowDate(data.window_start)} – {formatWindowDate(data.window_end)} · Path-level
        identity
      </p>
      {fromRow ? (
        <p className={textRole('caption')}>
          Sources:{' '}
          {rows.flatMap((row, index) =>
            row.link
              ? [
                  index ? ' · ' : null,
                  <PanelLink key={row.name} to={row.link.to}>
                    {row.link.label}
                  </PanelLink>,
                ]
              : [],
          )}
        </p>
      ) : null}
      {fromRow ? null : (
        <FactList
          layout="record"
          label="Page record"
          facts={rows.map((row) => ({
            key: row.name,
            label: row.name,
            value: row.value,
            note: row.note,
            end: row.link ? <PanelLink to={row.link.to}>{row.link.label}</PanelLink> : null,
          }))}
        />
      )}
      <Observations data={data} botLabel={botLabel} />
      <p className={textRole('caption')}>
        {data.provenance.bounded ? 'Timeline reached its display bound. ' : null}
        {data.provenance.crawl_id ? (
          <PanelLink to={website}>View Site health pages</PanelLink>
        ) : (
          'Inventory unavailable'
        )}
      </p>
    </Stack>
  );
}

function Observations({
  data,
  botLabel,
}: Readonly<{ data: UrlEvidenceData; botLabel: (botId: string) => string }>) {
  const rows: { key: string; name: string; detail: ReactNode }[] = [
    ...data.crawls.map((r) => ({
      key: `crawl:${r.bot_id}`,
      name: botLabel(r.bot_id),
      detail: (
        <>
          {formatCount(r.requests)} requests · <DisplayTime value={r.first_seen} dateOnly /> –{' '}
          <DisplayTime value={r.last_seen} dateOnly />
        </>
      ),
    })),
    ...data.referrals.map((r) => ({
      key: `referral:${r.ai_source}`,
      name: aiSourceLabel(r.ai_source),
      detail: `${formatCount(r.sessions)} sessions · first ${formatWindowDate(r.first_referral)}`,
    })),
    ...data.citations.map((r) => ({
      key: `citation:${r.citation_id}`,
      name: 'Tracked citation',
      detail: formatWindowDate(r.date),
    })),
  ];
  return (
    <Stack gap="tight">
      <h3 className={textRole('subheading')}>First and last observations</h3>
      {rows.length ? (
        <ul className="grid">
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-8 items-center justify-between gap-4">
              <span className={textRole('body', 'min-w-0 truncate')}>{row.name}</span>
              <span className={textRole('caption', 'shrink-0 tabular-nums')}>{row.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Absence state="none" />
      )}
    </Stack>
  );
}

function PanelLink({ to, children }: Readonly<{ to: string; children: ReactNode }>) {
  return (
    <TextLink asChild text="inherit">
      <Link to={to}>{children}</Link>
    </TextLink>
  );
}
export function TrafficUrlButton({
  urlHash,
  filters = {},
  label,
  children = 'View AI traffic',
}: Readonly<{
  urlHash: string;
  filters?: TrafficFilters;
  label?: string;
  children?: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => setOpen(true)}
        aria-label={label}
        className="max-w-full"
      >
        <Icon icon={PanelRightOpen} />
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
