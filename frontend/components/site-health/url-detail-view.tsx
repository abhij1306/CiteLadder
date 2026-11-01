import type { ReactNode } from 'react';

import { ListScreen } from '@/components/layout/page-shell';
import { Inline, Stack } from '@/components/ui/layout';
import { InternalLinksCard } from '@/components/site-health/internal-links-card';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { UrlScoreSummary } from '@/components/site-health/url-score-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { FactList } from '@/components/ui/facts';
import { QueryState } from '@/components/ui/query-state';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { ledgerClasses, ledgerItemClasses, SubsectionHeader } from '@/components/ui/workspace';
import type { DeliveryFacts, IssueOccurrence, PageDetail } from '@/lib/api/types';
import { severityBadgeValue, severityLabel, severityRank } from '@/lib/site-health/issues';
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

/**
 * One page of a crawl, in the order a site owner reads it: what to fix here,
 * then how the page scores, then — collapsed at the foot — the HTTP and
 * link-graph measurements only a developer reaches for. The measurements used
 * to lead the page at hero size and bury the fixes under them.
 */
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
  history?: ReactNode;
  children?: ReactNode;
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
        <PageMetaLine detail={detail} />
        {children}
        <LinkedFrom detail={detail} />
        <PageIssues issues={detail.issues} audited={detail.analysis_status === 'completed'} />
        <UrlScoreSummary detail={detail} />
        <TechnicalDetails detail={detail} />
      </Stack>
    </ListScreen>
  );
}

/** The page's URL, kind and audit date on one line; its status only when it is not done. */
function PageMetaLine({ detail }: Readonly<{ detail: PageDetail }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <Inline gap="meta" className="min-w-0 items-center">
      <TextLink
        variant="external"
        text="caption"
        href={detail.display_url}
        className="min-w-0 [overflow-wrap:anywhere]"
      >
        {detail.display_url}
      </TextLink>
      <PageKindBadge pageKind={detail.page_kind} />
      <span className="type-caption">Audited {formatAudited(detail.last_audited, timeZone)}</span>
      {detail.analysis_status === 'completed' ? null : (
        <Badge variant="status" value={pageStatusBadgeValue(detail.analysis_status)}>
          {statusLabel(detail.analysis_status)}
        </Badge>
      )}
    </Inline>
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

/**
 * The page's findings: defects first, worst first, and the count in the
 * heading counts only those. Advisories follow in their own group, labelled
 * as the catalog labels them, so a recommendation never reads as a rated
 * defect.
 */
function PageIssues({
  issues,
  audited,
}: Readonly<{
  issues: IssueOccurrence[];
  /** No issues before the audit finishes means "not checked yet", not "clean". */
  audited: boolean;
}>) {
  const defects = issues
    .filter((issue) => issue.finding_class === 'defect')
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const advisories = issues.filter((issue) => issue.finding_class !== 'defect');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Issues on this page ({defects.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="workspace">
          {defects.length === 0 ? (
            <QueryState
              kind="empty"
              inline
              message={
                audited
                  ? 'No issues found on this page.'
                  : 'Issues appear here once this page’s audit finishes.'
              }
            />
          ) : (
            <IssueRows issues={defects} />
          )}
          {advisories.length > 0 ? (
            <Stack as="section" gap="item">
              <SubsectionHeader
                title={`Advisories (${advisories.length})`}
                description="Recommendations to consider."
              />
              <IssueRows issues={advisories} />
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function IssueRows({ issues }: Readonly<{ issues: IssueOccurrence[] }>) {
  return (
    <ol className={ledgerClasses()}>
      {issues.map((issue) => (
        <Stack as="li" gap="tight" key={issue.occurrence_id} className={ledgerItemClasses()}>
          <Inline className="flex-wrap items-start justify-between">
            <span className={textRole('itemTitle', 'min-w-0')}>{issue.issue_title}</span>
            {issue.finding_class === 'defect' ? (
              <Badge variant="status" value={severityBadgeValue(issue.severity)}>
                {severityLabel(issue.severity)}
              </Badge>
            ) : (
              <Badge>Advisory</Badge>
            )}
          </Inline>
          <IssueEvidence occurrence={issue} />
          {issue.remediation ? (
            <p className="type-body whitespace-pre-line">{issue.remediation}</p>
          ) : null}
        </Stack>
      ))}
    </ol>
  );
}

/** HTTP delivery and link-graph measurements, closed by default at the page's foot. */
function TechnicalDetails({ detail }: Readonly<{ detail: PageDetail }>) {
  return (
    <Card className="min-w-0">
      <CardContent>
        <Disclosure title="Technical details">
          <Stack gap="workspace" className="min-w-0">
            <Stack as="section" gap="item">
              <SubsectionHeader title="Delivery" description="Static HTTP-level measurements" />
              <DeliveryMetrics delivery={detail.delivery} />
            </Stack>
            <Stack as="section" gap="item">
              <SubsectionHeader title="Internal links" />
              {detail.internal_links ? (
                <InternalLinksCard links={detail.internal_links} crawlId={detail.crawl_id} />
              ) : (
                <QueryState
                  kind="empty"
                  inline
                  message="Internal links not measured for this page."
                />
              )}
            </Stack>
          </Stack>
        </Disclosure>
      </CardContent>
    </Card>
  );
}

function measured(value: string | null): ReactNode {
  return value === null ? <UnavailableValue state="not_measured" /> : value;
}

function DeliveryMetrics({ delivery }: Readonly<{ delivery: DeliveryFacts }>) {
  const facts = [
    { label: 'TTFB', value: formatMeasuredMs(delivery.ttfb_ms) },
    { label: 'Response Size', value: formatBytes(delivery.decoded_bytes ?? delivery.html_bytes) },
    {
      label: 'HTTP Status',
      value: delivery.status_code === null ? null : `${delivery.status_code}`,
    },
    { label: 'Compression', value: delivery.compression ?? 'none' },
    { label: 'HTTP Version', value: delivery.http_version ?? null },
    { label: 'Cache-Control', value: delivery.cache_control ?? null },
    {
      label: 'Blocking Resources',
      value:
        delivery.blocking_resource_count === null ? null : `${delivery.blocking_resource_count}`,
    },
    { label: 'Wire Size', value: formatBytes(delivery.wire_bytes) },
  ];
  return (
    <FactList
      layout="ruled"
      label="Delivery"
      facts={facts.map((fact) => ({ label: fact.label, value: measured(fact.value) }))}
    />
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
