import { useState, useSyncExternalStore } from 'react';

import { ListScreen } from '@/components/layout/page-shell';
import { Inline, Stack } from '@/components/ui/layout';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { InternalLinksCard } from '@/components/site-health/internal-links-card';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { UrlScoreSummary } from '@/components/site-health/url-score-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { StatRow, type StatSegment } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { DeliveryFacts, IssueOccurrence, PageDetail } from '@/lib/api/types';
import {
  dimensionLabel,
  severityBadgeValue,
  severityLabel,
  severityRank,
} from '@/lib/site-health/issues';
import {
  formatAudited,
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
} from '@/lib/site-health/status';
import { TrafficUrlButton } from '@/components/ai-traffic/url-panel';

/** Queued is neither "running" nor "ready to ask again": it is its own state. */
function rerunLabel(pending: boolean, queued: boolean): string {
  if (pending) return 'Re-auditing…';
  if (queued) return 'Re-audit queued';
  return 'Re-audit this page';
}

export function UrlDetailView({
  detail,
  rerunPending,
  rerunQueued,
  onRerun,
  history,
  children,
}: Readonly<{
  detail: PageDetail;
  rerunPending: boolean;
  rerunQueued: boolean;
  onRerun: () => void;
  /** The page action that opens its resolved-issue history. */
  history?: React.ReactNode;
  children?: React.ReactNode;
}>) {
  return (
    <ListScreen
      title={pageDisplayTitle(detail.title, detail.display_url)}
      actions={
        <>
          {history}
          {detail.url_hash ? <TrafficUrlButton urlHash={detail.url_hash} /> : null}
          <Button onClick={onRerun} disabled={rerunPending}>
            {rerunLabel(rerunPending, rerunQueued)}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        <PageMetadata detail={detail} />
        <LinkedFrom detail={detail} />
        <UrlScoreSummary detail={detail} />
        <PageMeasurements detail={detail} />
        <IssuesList issues={detail.issues} />
        {children}
      </Stack>
    </ListScreen>
  );
}

const LINKS_NOT_MEASURED = 'Internal links not measured for this page.';

const mobileMeasurementsQuery = '(max-width: 980px)';

function subscribeMobileMeasurements(notify: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return () => undefined;
  const media = window.matchMedia(mobileMeasurementsQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

function isMobileMeasurementsViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(mobileMeasurementsQuery).matches
    : false;
}

function PageMeasurements({ detail }: Readonly<{ detail: PageDetail }>) {
  const [selected, setSelected] = useState<'delivery' | 'links'>('delivery');
  const isMobile = useSyncExternalStore(
    subscribeMobileMeasurements,
    isMobileMeasurementsViewport,
    () => false,
  );
  if (isMobile) {
    return (
      <Stack gap="workspace" className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Delivery Metrics</CardTitle>
            <CardDescription>Static HTTP-level measurements</CardDescription>
          </CardHeader>
          <CardContent>
            <DeliveryMetrics delivery={detail.delivery} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            {/* The card states its own crawl scope; repeating it here doubled it. */}
            <CardTitle>Internal Links</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.internal_links ? (
              <InternalLinksCard links={detail.internal_links} crawlId={detail.crawl_id} />
            ) : (
              <QueryState kind="empty" inline message={LINKS_NOT_MEASURED} />
            )}
          </CardContent>
        </Card>
      </Stack>
    );
  }
  return (
    <Card className="min-w-0">
      <CardContent>
        <Tabs
          value={selected}
          onValueChange={setSelected}
          items={[
            { value: 'delivery', label: 'Delivery Metrics' },
            { value: 'links', label: 'Internal Links' },
          ]}
          ariaLabel="Page measurements"
          spaced
        >
          <TabPanel value="delivery" forceMount>
            <DeliveryMetrics delivery={detail.delivery} />
          </TabPanel>
          <TabPanel value="links" forceMount>
            {detail.internal_links ? (
              <InternalLinksCard links={detail.internal_links} crawlId={detail.crawl_id} />
            ) : (
              <QueryState kind="empty" inline message={LINKS_NOT_MEASURED} />
            )}
          </TabPanel>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** A URL that failed to fetch: the pages that link it, which is where the fix goes. */
function LinkedFrom({ detail }: Readonly<{ detail: PageDetail }>) {
  if (!isFetchFailure(detail.analysis_status) || !detail.linked_from.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Linked From</CardTitle>
        <CardDescription>Pages this crawl found linking to this URL</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className={ledgerClasses()}>
          {detail.linked_from.map((referrer) => (
            <li key={referrer.site_url_id} className={ledgerItemClasses()}>
              <TextLink
                variant="external"
                href={referrer.url}
                className="min-w-0 [overflow-wrap:anywhere] tabular-nums"
              >
                {referrer.url}
              </TextLink>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PageMetadata({ detail }: Readonly<{ detail: PageDetail }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <Card className="min-w-0">
      <CardContent>
        <StatRow
          segments={[
            {
              key: 'url',
              label: 'URL',
              value: (
                <TextLink
                  variant="external"
                  text="itemTitle"
                  href={detail.display_url}
                  className="min-w-0 [overflow-wrap:anywhere] tabular-nums"
                >
                  {detail.display_url}
                </TextLink>
              ),
            },
            {
              key: 'kind',
              label: 'Page Kind',
              value: <PageKindBadge pageKind={detail.page_kind} />,
            },
            {
              key: 'audit',
              label: 'Last Audit',
              value: (
                <span className={textRole('itemTitle')}>
                  {formatAudited(detail.last_audited, timeZone)}
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              value: (
                <Badge variant="status" value={pageStatusBadgeValue(detail.analysis_status)}>
                  {statusLabel(detail.analysis_status)}
                </Badge>
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function DeliveryMetrics({ delivery }: Readonly<{ delivery: DeliveryFacts }>) {
  const segments: StatSegment[] = [
    { key: 'ttfb', label: 'TTFB', value: formatMeasuredMs(delivery.ttfb_ms) },
    {
      key: 'size',
      label: 'Response Size',
      value: formatBytes(delivery.decoded_bytes ?? delivery.html_bytes),
    },
    {
      key: 'status',
      label: 'HTTP Status',
      value: delivery.status_code === null ? null : `${delivery.status_code}`,
    },
    { key: 'compression', label: 'Compression', value: delivery.compression ?? 'none' },
    { key: 'version', label: 'HTTP Version', value: delivery.http_version ?? null },
    { key: 'cache', label: 'Cache-Control', value: delivery.cache_control ?? null },
    {
      key: 'blocking',
      label: 'Blocking Resources',
      value:
        delivery.blocking_resource_count === null ? null : `${delivery.blocking_resource_count}`,
    },
    { key: 'wire', label: 'Wire Size', value: formatBytes(delivery.wire_bytes) },
  ];
  return (
    <Stack>
      <p className={textRole('caption', 'hidden desktop:block')}>Static HTTP-level measurements</p>
      <StatRow segments={segments} />
    </Stack>
  );
}

function IssuesList({ issues }: Readonly<{ issues: IssueOccurrence[] }>) {
  const ordered = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return (
    <Card>
      <CardHeader actions={<span className="type-caption">Sorted by severity</span>}>
        <CardTitle>All Issues ({issues.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <QueryState kind="empty" inline message="No issues detected on this page." />
        ) : (
          <ol className={ledgerClasses()}>
            {ordered.map((issue) => (
              <Inline
                as="li"
                gap="compact"
                key={issue.occurrence_id}
                className={ledgerItemClasses('flex-wrap items-start justify-between')}
              >
                <Stack gap="item" className="min-w-0">
                  <span className={textRole('itemTitle')}>{issue.issue_title}</span>
                  <IssueEvidence occurrence={issue} />
                </Stack>
                <Inline className="shrink-0 flex-wrap">
                  <Badge>{dimensionLabel(issue.dimension)}</Badge>
                  <Badge variant="status" value={severityBadgeValue(issue.severity)}>
                    {severityLabel(issue.severity)}
                  </Badge>
                </Inline>
              </Inline>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function formatMeasuredMs(value: number | null): string | null {
  return value === null || value <= 0 ? null : `${Math.round(value)}ms`;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round((bytes / 1024) * 10) / 10} KB`;
}
