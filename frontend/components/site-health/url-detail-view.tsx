import type { ReactNode } from 'react';

import { RecordPage } from '@/components/templates/record-page';
import type { Crumb } from '@/components/ui/breadcrumb';
import { Inline, Stack } from '@/components/ui/layout';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import { UrlText } from '@/components/ui/table';
import { InternalLinksCard } from '@/components/site-health/internal-links-card';
import { PageIssues, type RerunControl } from '@/components/site-health/page-issues';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { RobotsExcludedBadge } from '@/components/site-health/robots-choice';
import { UrlScoreSummary } from '@/components/site-health/url-score-summary';
import { StatusMark } from '@/components/ui/status-mark';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FactList } from '@/components/ui/facts';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { ledgerClasses, ledgerItemClasses, SubsectionHeader } from '@/components/ui/workspace';
import type { DeliveryFacts, PageDetail } from '@citeladder/contracts';
import { formatDisplayTimestamp } from '@/lib/format';
import {
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
} from '@/lib/site-health/status';
import { TrafficUrlButton } from '@/components/ai-traffic/url-panel';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';

export const PAGE_DETAIL_TRAIL: readonly Crumb[] = [
  { label: 'Site health', href: '/site' },
  { label: 'Pages', href: '/site?tab=pages' },
];

const rerunLabel = (pending: boolean) => (pending ? 'Re-auditing…' : 'Re-audit this page');

export function UrlDetailView({
  detail,
  rerun,
  history,
  children,
}: Readonly<{
  detail: PageDetail;
  rerun?: RerunControl;
  history?: ReactNode;
  children?: ReactNode;
}>) {
  const title = pageDisplayTitle(detail.title, detail.display_url);
  useAgentPanelSeed(pageHandoff(detail));
  return (
    <RecordPage
      title={title}
      trail={PAGE_DETAIL_TRAIL}
      identity={
        <PageIdentity
          detail={detail}
          actions={
            <>
              {history}
              {detail.url_hash ? <TrafficUrlButton urlHash={detail.url_hash} /> : null}
            </>
          }
        />
      }
      actions={
        rerun ? (
          <Button variant="primary" onClick={rerun.onRerun} disabled={rerun.busy}>
            {rerunLabel(rerun.busy)}
          </Button>
        ) : undefined
      }
    >
      {children}
      <LinkedFrom detail={detail} />
      <UrlScoreSummary detail={detail} />
      <PageIssues
        issues={detail.issues}
        audited={detail.analysis_status === 'completed'}
        crawlId={detail.crawl_id}
      />
      <TechnicalDetails detail={detail} />
    </RecordPage>
  );
}

function pageHandoff(detail: PageDetail) {
  const count = detail.issues.filter((issue) => issue.finding_class === 'defect').length;
  return {
    siteUrlId: detail.site_url_id,
    targetUrl: detail.display_url,
    prompt: pagePrompt(detail, count),
    skillId: 'technical_health',
  };
}

function pagePrompt(detail: PageDetail, count: number): string {
  const url = detail.display_url;
  if (count > 0) {
    const issues = count === 1 ? '1 Website issue' : `${count} Website issues`;
    return `Review the ${issues} on ${url}, worst first, and propose exact page edits for each.`;
  }
  if (detail.analysis_status !== 'completed')
    return `The Website audit of ${url} did not complete (${statusLabel(detail.analysis_status)}). Investigate why and say what is needed to audit it.`;
  return `Review ${url} for search and answer-engine readiness and propose improvements.`;
}

function PageIdentity({ detail, actions }: Readonly<{ detail: PageDetail; actions: ReactNode }>) {
  const timeZone = useDisplayTimeZone();
  const facts = [
    {
      label: 'URL',
      value: (
        <TextLink
          variant="external"
          text="body"
          underline="hover"
          href={detail.display_url}
          className="flex min-w-0 items-center"
        >
          <UrlText url={detail.display_url} />
        </TextLink>
      ),
    },
    { label: 'Kind', value: <PageKindBadge pageKind={detail.page_kind} /> },
    {
      label: 'Audited',
      value: detail.last_audited ? (
        formatDisplayTimestamp(detail.last_audited, timeZone)
      ) : (
        <Absence state="not_measured" />
      ),
    },
    ...(detail.analysis_status === 'completed'
      ? []
      : [
          {
            label: 'Status',
            value: (
              <StatusMark variant="status" value={pageStatusBadgeValue(detail.analysis_status)}>
                {statusLabel(detail.analysis_status)}
              </StatusMark>
            ),
          },
        ]),
    ...(detail.robots_excluded ? [{ label: 'Robots', value: <RobotsExcludedBadge /> }] : []),
  ];
  return (
    <Stack gap="item" className="min-w-0" data-testid="page-identity">
      <FactList layout="inline" label="Page" facts={facts} />
      <Inline className="flex-wrap">{actions}</Inline>
    </Stack>
  );
}

function LinkedFrom({ detail }: Readonly<{ detail: PageDetail }>) {
  if (!isFetchFailure(detail.analysis_status) || !detail.linked_from.length) return null;
  return (
    <Section className="min-w-0">
      <SectionHeader>
        <SectionTitle>Linked from</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <ul className={ledgerClasses()}>
          {detail.linked_from.map((referrer) => (
            <li key={referrer.site_url_id} className={ledgerItemClasses()}>
              <TextLink
                variant="external"
                href={referrer.url}
                title={referrer.url}
                className="block min-w-0 truncate"
              >
                {referrer.url}
              </TextLink>
            </li>
          ))}
        </ul>
      </SectionContent>
    </Section>
  );
}

function TechnicalDetails({ detail }: Readonly<{ detail: PageDetail }>) {
  return (
    <Section className="min-w-0">
      <SectionContent>
        <Disclosure title="Technical details">
          <Stack gap="workspace" className="min-w-0">
            <Stack as="section" gap="item">
              <SubsectionHeader title="Delivery" />
              <DeliveryMetrics delivery={detail.delivery} />
            </Stack>
            <Stack as="section" gap="item">
              <SubsectionHeader title="Internal links" />
              {detail.internal_links ? (
                <InternalLinksCard links={detail.internal_links} crawlId={detail.crawl_id} />
              ) : (
                <StateBlock
                  kind="empty"
                  inline
                  message="Internal links weren't counted for this page."
                />
              )}
            </Stack>
          </Stack>
        </Disclosure>
      </SectionContent>
    </Section>
  );
}

function factValue(value: string | null): ReactNode {
  return value ?? <Absence state="not_measured" />;
}

function DeliveryMetrics({ delivery }: Readonly<{ delivery: DeliveryFacts }>) {
  const facts = [
    { label: 'TTFB', value: formatMeasuredMs(delivery.ttfb_ms) },
    { label: 'Response size', value: formatBytes(delivery.decoded_bytes ?? delivery.html_bytes) },
    {
      label: 'HTTP status',
      value: delivery.status_code === null ? null : `${delivery.status_code}`,
    },
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
      facts={facts.map((fact) => ({ label: fact.label, value: factValue(fact.value) }))}
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
