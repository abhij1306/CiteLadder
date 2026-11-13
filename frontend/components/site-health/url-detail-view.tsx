import type { ReactNode } from 'react';

import { DetailScreen, type PageBack } from '@/components/layout/page-shell';
import { AskAgentLink } from '@/components/agent/ask-agent-link';
import { Inline, Stack } from '@/components/ui/layout';
import { InternalLinksCard } from '@/components/site-health/internal-links-card';
import { PageIssues, type RerunControl } from '@/components/site-health/page-issues';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { RobotsExcludedBadge } from '@/components/site-health/robots-choice';
import { UrlScoreSummary } from '@/components/site-health/url-score-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { FactList } from '@/components/ui/facts';
import { QueryState } from '@/components/ui/query-state';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { ledgerClasses, ledgerItemClasses, SubsectionHeader } from '@/components/ui/workspace';
import type { DeliveryFacts, PageDetail } from '@citeladder/contracts';
import {
  formatAudited,
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
} from '@/lib/site-health/status';
import { TrafficUrlButton } from '@/components/ai-traffic/url-panel';

/** A page detail's way back: the Pages tab of Website, where its rows live. */
export const PAGE_DETAIL_BACK: PageBack = { href: '/site?tab=pages', label: 'Back to Pages' };

/** Queued is neither "running" nor "ready to ask again": it is its own state. */
const rerunLabel = (pending: boolean) => (pending ? 'Re-auditing…' : 'Re-audit this page');

/**
 * One page of a crawl, in the order a site owner reads it: how the page
 * scores, every issue on it worst first, each issue with its fix and the ways
 * to act on it, then — collapsed at the foot — the HTTP and link-graph
 * measurements only a developer reaches for.
 */
export function UrlDetailView({
  detail,
  rerun,
  history,
  children,
}: Readonly<{
  detail: PageDetail;
  /** Re-audits the page, for a role that may run one. */
  rerun?: RerunControl;
  /** The page action that opens its resolved-issue history. */
  history?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <DetailScreen
      title={pageDisplayTitle(detail.title, detail.display_url)}
      back={PAGE_DETAIL_BACK}
      lead={<PageMetaLine detail={detail} />}
      actions={
        <>
          {history}
          {detail.url_hash ? <TrafficUrlButton urlHash={detail.url_hash} /> : null}
          <AskAgentLink handoff={pageHandoff(detail)}>Ask agent about this page</AskAgentLink>
          {rerun ? (
            <Button variant="primary" onClick={rerun.onRerun} disabled={rerun.busy}>
              {rerunLabel(rerun.busy)}
            </Button>
          ) : null}
        </>
      }
    >
      {children}
      <LinkedFrom detail={detail} />
      <UrlScoreSummary detail={detail} />
      <PageIssues
        issues={detail.issues}
        audited={detail.analysis_status === 'completed'}
        crawlId={detail.crawl_id}
        rerun={rerun}
      />
      <TechnicalDetails detail={detail} />
    </DetailScreen>
  );
}

/** The whole page for the agent: its id and URL, never its evidence. */
function pageHandoff(detail: PageDetail) {
  const count = detail.issues.filter((issue) => issue.finding_class === 'defect').length;
  return {
    siteUrlId: detail.site_url_id,
    targetUrl: detail.display_url,
    prompt: pagePrompt(detail, count),
    skillId: 'technical_health',
  };
}

/** Its issues worst first; with none, readiness only once the audit finished. */
function pagePrompt(detail: PageDetail, count: number): string {
  const url = detail.display_url;
  if (count > 0) {
    const issues = count === 1 ? '1 Site Health issue' : `${count} Site Health issues`;
    return `Review the ${issues} on ${url}, worst first, and propose exact page edits for each.`;
  }
  if (detail.analysis_status !== 'completed')
    return `The Site Health audit of ${url} did not complete (${statusLabel(detail.analysis_status)}). Investigate why and say what is needed to audit it.`;
  return `Review ${url} for search and answer-engine readiness and propose improvements.`;
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
        title={detail.display_url}
        className="min-w-0 truncate"
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
      {detail.robots_excluded ? <RobotsExcludedBadge /> : null}
    </Inline>
  );
}

/** A URL that failed to fetch: the pages that link it, which is where the fix goes. */
function LinkedFrom({ detail }: Readonly<{ detail: PageDetail }>) {
  if (!isFetchFailure(detail.analysis_status) || !detail.linked_from.length) return null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Linked from</CardTitle>
        <CardDescription>Pages this crawl found linking to this URL</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className={ledgerClasses()}>
          {detail.linked_from.map((referrer) => (
            <li key={referrer.site_url_id} className={ledgerItemClasses()}>
              <TextLink
                variant="external"
                href={referrer.url}
                title={referrer.url}
                className="block min-w-0 truncate tabular-nums"
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
  return value ?? <UnavailableValue state="not_measured" />;
}

function DeliveryMetrics({ delivery }: Readonly<{ delivery: DeliveryFacts }>) {
  const facts = [
    { label: 'TTFB', value: formatMeasuredMs(delivery.ttfb_ms) },
    { label: 'Response size', value: formatBytes(delivery.decoded_bytes ?? delivery.html_bytes) },
    {
      label: 'HTTP status',
      value: delivery.status_code === null ? null : `${delivery.status_code}`,
    },
    // Null is "not known", never "no compression".
    { label: 'Compression', value: delivery.compression ?? null },
    { label: 'HTTP version', value: delivery.http_version ?? null },
    { label: 'Cache-Control', value: delivery.cache_control ?? null },
    {
      label: 'Blocking resources',
      value:
        delivery.blocking_resource_count === null ? null : `${delivery.blocking_resource_count}`,
    },
    { label: 'Wire size', value: formatBytes(delivery.wire_bytes) },
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
