'use client';

import { ProjectLink } from '@/components/layout/scoped-link';

import { Badge } from '@/components/ui/badge';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { ReadError } from '@/components/ui/read-error';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { QueryState } from '@/components/ui/query-state';
import { Inline, Stack } from '@/components/ui/layout';
import { ListDetailPane } from '@/components/ui/list-detail';
import { Pager } from '@/components/ui/pager';
import { panelClasses } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import type { SiteIssue, SiteIssueDetail } from '@/lib/api/types';
import { originOf, sitePath } from '@/lib/site-health/evidence-values';
import {
  linkOutcomeLabel,
  pageCountLabel,
  siteLevelEvidence,
  type SiteLevelEvidence,
} from '@/lib/site-health/site-level-evidence';
import { dimensionLabel, issueTitle, severityLabel } from '@/lib/site-health/issues';
import { pageKindLabel } from '@/lib/site-health/page-kinds';
import { pageDisplayTitle } from '@/lib/site-health/status';

/**
 * The right half of the Issues catalog: one issue in full, and the pages it
 * was found on. It lives beside the list rather than inside it because the
 * two answer different questions — which issues exist, and what this one is.
 */
export function IssueDetailRail({
  issue,
  crawlId,
  detailQuery,
  canPrevious,
  onPrevious,
  onNext,
}: Readonly<{
  issue: SiteIssue;
  crawlId: string;
  detailQuery: UseQueryResult<SiteIssueDetail>;
  canPrevious: boolean;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  const detail = detailQuery.isError ? undefined : detailQuery.data;
  useAgentPanelSeed({
    issueGroup: { crawlId, groupId: issue.group_id },
    prompt: askAgentPrompt(issue),
    skillId: 'technical_health',
  });
  return (
    <ListDetailPane
      busy={{ active: detailQuery.isFetching, label: 'Updating issue evidence' }}
      header={
        <>
          <Stack gap="item" className="min-w-0">
            <h2 className={textRole('sectionTitle')}>{issueTitle(issue)}</h2>
            <IssueMetadata issue={issue} />
            <Inline gap="meta" className="type-body">
              <span className="text-secondary whitespace-nowrap tabular-nums">
                {issue.affected_url_count} {issue.affected_url_count === 1 ? 'page' : 'pages'}{' '}
                affected
              </span>
              {issue.page_kinds.length > 0 ? (
                <Inline as="span" gap="tight" className="type-caption flex-wrap">
                  <span>Affects</span>
                  {issue.page_kinds.map((kind, index) => (
                    <span key={kind} className="contents">
                      {index > 0 ? <span aria-hidden>·</span> : null}
                      <span>{pageKindLabel(kind)}</span>
                    </span>
                  ))}
                </Inline>
              ) : null}
            </Inline>
          </Stack>
          <IssueActions issue={issue} crawlId={crawlId} />
        </>
      }
      footer={
        detail ? (
          // The retained page keeps its `next_cursor` while the next one is in
          // flight, so a second click would push the SAME cursor onto the
          // stack and Previous would need two presses to undo one: `busy`
          // holds both steps until the page lands.
          <Pager
            frame="table"
            hideWhenSinglePage
            canPrev={canPrevious}
            canNext={Boolean(detail.next_cursor)}
            onPrev={onPrevious}
            onNext={onNext}
            busy={detailQuery.isFetching}
          />
        ) : null
      }
    >
      {/* The rule's description is phrased as the PASSING state ("Page is not
          blocked from indexing…"); printed under a failing title it read as a
          contradiction. The fix is what the reader came for. */}
      {issue.remediation ? (
        <Stack gap="tight" className={panelClasses({ tone: 'tonal' })}>
          <span className={textRole('label')}>How to fix</span>
          <p className="type-body whitespace-pre-line">{issue.remediation}</p>
        </Stack>
      ) : null}
      <Stack as="section">
        <h3 className={textRole('itemTitle')}>Affected pages</h3>
        <OccurrenceList issue={issue} detail={detail} crawlId={crawlId} query={detailQuery} />
      </Stack>
    </ListDetailPane>
  );
}

/**
 * Every issue gets an action: the fix prompt a developer or assistant can use,
 * and Ask agent, which starts a chat about it in the Agent workspace.
 */
function IssueActions({ issue, crawlId }: Readonly<{ issue: SiteIssue; crawlId: string }>) {
  return (
    <Inline className="flex-wrap">
      <Button asChild>
        <ProjectLink
          href={agentHandoffHref({
            issueGroup: { crawlId, groupId: issue.group_id },
            prompt: askAgentPrompt(issue),
            skillId: 'technical_health',
          })}
        >
          Ask agent
        </ProjectLink>
      </Button>
      <CopyButton value={buildFixPrompt(issue)} variant="secondary" className="w-fit">
        Copy fix prompt
      </CopyButton>
    </Inline>
  );
}

function askAgentPrompt(issue: SiteIssue, page?: string): string {
  const count = issue.affected_url_count;
  const pages = count === 1 ? 'page' : 'pages';
  const scope = page ? ` on ${page}` : ` (${count} affected ${pages})`;
  return page
    ? `Analyze the Site Health issue "${issueTitle(issue)}"${scope} and propose exact page edits from the selected evidence.`
    : `Analyze the Site Health issue "${issueTitle(issue)}"${scope}, prioritize the work and propose a bounded implementation plan. Label sampled occurrences and distinguish them from the total affected pages.`;
}

const OCCURRENCE_PLACEHOLDERS = ['first', 'second', 'third'] as const;

function OccurrenceList({
  issue,
  detail,
  crawlId,
  query,
}: Readonly<{
  issue: SiteIssue;
  detail: SiteIssueDetail | undefined;
  crawlId: string;
  query: UseQueryResult<SiteIssueDetail>;
}>) {
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load affected URLs."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  // The list no longer waits for this read, so "none" and "not yet" are now
  // genuinely different answers here. Claiming the first while the second is
  // true told the reader an issue affected nothing, a moment before showing
  // them the pages it affects.
  if (query.isPending || !detail) {
    return (
      <ul aria-busy="true" className={ledgerClasses('open')}>
        {OCCURRENCE_PLACEHOLDERS.map((placeholder) => (
          <Stack as="li" gap="item" key={placeholder} className={ledgerItemClasses()}>
            <Skeleton shape="line" />
            <Skeleton shape="line" />
          </Stack>
        ))}
      </ul>
    );
  }
  if (detail.occurrences.length === 0)
    return <QueryState kind="empty" inline message="No affected URLs found." />;
  // A site-level finding has one occurrence, on the homepage; the pages it
  // found are in that occurrence's evidence.
  const first = detail.occurrences[0];
  const siteLevel = first ? siteLevelEvidence(issue.rule_id, first.evidence) : null;
  if (siteLevel) return <SiteLevelList evidence={siteLevel} crawlId={crawlId} />;
  return (
    <ul className={ledgerClasses('open')}>
      {detail.occurrences.map((occurrence) => (
        <Stack as="li" gap="tight" key={occurrence.occurrence_id} className={ledgerItemClasses()}>
          <AffectedPageLink
            crawlId={crawlId}
            siteUrlId={occurrence.site_url_id}
            title={occurrence.title}
            url={occurrence.display_url}
            pageKind={occurrence.page_kind}
          />
          <IssueEvidence occurrence={occurrence} />
          <TextLink
            text="caption"
            className="w-fit"
            href={agentHandoffHref({
              issueGroup: { crawlId, groupId: issue.group_id, siteUrlId: occurrence.site_url_id },
              prompt: askAgentPrompt(issue, occurrence.display_url),
              skillId: 'technical_health',
            })}
          >
            Ask agent about this page
          </TextLink>
        </Stack>
      ))}
    </ul>
  );
}

/** One affected page: its title and kind, linking to its detail, over its URL. */
function AffectedPageLink({
  crawlId,
  siteUrlId,
  title,
  url,
  pageKind,
}: Readonly<{
  crawlId: string;
  siteUrlId: string;
  title: string | null;
  url: string;
  pageKind: string | null;
}>) {
  return (
    <TextLink
      text="inherit"
      className="flex min-w-0 flex-col"
      href={`/site/crawls/${crawlId}/pages/${siteUrlId}`}
    >
      <Inline as="span" className="flex-wrap">
        <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
          {pageDisplayTitle(title, url)}
        </span>
        {pageKind ? <Badge>{pageKindLabel(pageKind)}</Badge> : null}
      </Inline>
      <span className="type-caption [overflow-wrap:anywhere] tabular-nums" title={url}>
        {url}
      </span>
    </TextLink>
  );
}

function SiteLevelList({
  evidence,
  crawlId,
}: Readonly<{ evidence: SiteLevelEvidence; crawlId: string }>) {
  if (evidence.kind === 'page_kinds') {
    return (
      <ul className={ledgerClasses('open')}>
        {evidence.pageKinds.map((row) => (
          <Inline
            as="li"
            key={row.pageKind}
            className={ledgerItemClasses('flex-wrap justify-between')}
          >
            <span className={textRole('itemTitle')}>{pageKindLabel(row.pageKind)}</span>
            {row.pageCount === null ? null : (
              <span className="type-caption tabular-nums">
                {row.pageCount} {row.pageCount === 1 ? 'page' : 'pages'}
              </span>
            )}
          </Inline>
        ))}
      </ul>
    );
  }
  if (evidence.kind === 'link_targets')
    return <LinkTargetList evidence={evidence} crawlId={crawlId} />;
  if (evidence.pages.length === 0)
    return (
      <QueryState
        kind="empty"
        inline
        message={
          evidence.total > 0
            ? 'This finding did not record which pages it affects.'
            : 'No affected URLs found.'
        }
      />
    );
  const hidden = evidence.total - evidence.pages.length;
  return (
    <Stack gap="item">
      {evidence.sections.length > 0 ? (
        <ul className={ledgerClasses('open')}>
          {evidence.sections.map((section) => (
            <Inline
              as="li"
              key={section.pathPrefix}
              className={ledgerItemClasses('flex-wrap justify-between')}
            >
              <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
                {section.pathPrefix}
              </span>
              <span className="type-caption tabular-nums">{pageCountLabel(section.pageCount)}</span>
            </Inline>
          ))}
        </ul>
      ) : null}
      <ul className={ledgerClasses('open')}>
        {evidence.pages.map((page) => (
          <Stack as="li" gap="tight" key={page.siteUrlId} className={ledgerItemClasses()}>
            <AffectedPageLink
              crawlId={crawlId}
              siteUrlId={page.siteUrlId}
              title={page.title}
              url={page.url}
              pageKind={page.pageKind}
            />
            {page.clicksFromHome === null ? null : (
              <span className="type-caption tabular-nums">
                {page.clicksFromHome} clicks from the homepage
              </span>
            )}
          </Stack>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="type-caption">
          Showing {evidence.pages.length} of {evidence.total} pages.
        </p>
      ) : null}
    </Stack>
  );
}

/**
 * A sitewide link finding, one row per link target: where the link lands, how
 * many pages carry it, and a sample of them. One template fix clears the row.
 */
function LinkTargetList({
  evidence,
  crawlId,
}: Readonly<{
  evidence: Extract<SiteLevelEvidence, { kind: 'link_targets' }>;
  crawlId: string;
}>) {
  if (evidence.targets.length === 0)
    return (
      <QueryState
        kind="empty"
        inline
        message={
          evidence.total === 0
            ? 'No affected links found.'
            : 'This finding did not record which links it affects.'
        }
      />
    );
  return (
    <ul className={ledgerClasses('open')}>
      {evidence.targets.map((target) => {
        const origin = originOf(target.url);
        const hidden = target.pageCount - target.pages.length;
        return (
          <Stack as="li" gap="tight" key={target.url} className={ledgerItemClasses()}>
            <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
              {sitePath(target.url, origin)} → {linkOutcomeLabel(target.outcome, origin)}
            </span>
            <span className="type-caption tabular-nums">
              On {pageCountLabel(target.pageCount)}
              {hidden > 0 ? ', including:' : ':'}
            </span>
            {target.pages.map((page) => (
              <AffectedPageLink
                key={page.siteUrlId}
                crawlId={crawlId}
                siteUrlId={page.siteUrlId}
                title={page.title}
                url={page.url}
                pageKind={page.pageKind}
              />
            ))}
          </Stack>
        );
      })}
    </ul>
  );
}

function buildFixPrompt(issue: SiteIssue): string {
  const rating =
    issue.finding_class === 'defect' ? `${severityLabel(issue.severity)} severity` : 'advisory';
  const lines = [
    `Fix this Site Health issue on my website: "${issueTitle(issue)}" (${dimensionLabel(issue.dimension)}, ${rating}).`,
  ];
  if (issue.description) lines.push('', 'The check passes when:', issue.description);
  if (issue.remediation) lines.push('', 'Recommended remediation:', issue.remediation);
  return lines.join('\n');
}
