import { AskAgentLink } from '@/components/agent/ask-agent-link';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { IssueFixActions, type IssueFixScope } from '@/components/site-health/issue-fix-actions';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { AffectedPageLink, SharedOccurrences } from '@/components/site-health/shared-occurrences';
import { ReadError } from '@/components/ui/read-error';
import type { UseQueryResult } from '@tanstack/react-query';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { QueryState } from '@/components/ui/query-state';
import { Inline, Stack } from '@/components/ui/layout';
import { Pager } from '@/components/ui/pager';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import type { IssueOccurrence, SiteIssue, SiteIssueDetail } from '@citeladder/contracts';
import { originOf, sitePath } from '@/lib/site-health/evidence-values';
import {
  linkOutcomeLabel,
  pageCountLabel,
  siteLevelEvidence,
  type SiteLevelEvidence,
} from '@/lib/site-health/site-level-evidence';
import { dimensionLabel, issueTitle, severityLabel } from '@/lib/site-health/issues';
import { groupOccurrences, loadedPageCount } from '@/lib/site-health/occurrence-groups';
import { pageKindLabel } from '@/lib/site-health/page-kinds';

/**
 * The issue a dialog describes: its catalog row, or — for an issue the address
 * names that is not on the listed page — its detail, which carries the same
 * facts but no page types.
 */
export type IssueHead = Pick<
  SiteIssue,
  | 'group_id'
  | 'rule_id'
  | 'title'
  | 'dimension'
  | 'severity'
  | 'finding_class'
  | 'description'
  | 'remediation'
  | 'affected_url_count'
> &
  Partial<Pick<SiteIssue, 'page_kinds'>>;

/**
 * One issue in full, over the Issues list: what it is, how to fix it, the ways
 * to act on it, how many of its pages are fixed (Mark fixed, Re-run all), and
 * the pages it was found on, each linking to its page.
 */
export function IssueDetailDialog({
  issue,
  scope,
  crawlId,
  detailQuery,
  canPrevious,
  onPrevious,
  onNext,
  onClose,
}: Readonly<{
  issue: IssueHead;
  /** The project the crawl belongs to: Re-run all refreshes its reads once it lands. */
  scope: IssueFixScope;
  crawlId: string;
  detailQuery: UseQueryResult<SiteIssueDetail>;
  canPrevious: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}>) {
  // The query keeps the previous issue's page while this one loads; those
  // pages are not this issue's, so the dialog waits rather than caption them.
  const loaded = detailQuery.isError ? undefined : detailQuery.data;
  const detail = loaded?.group_id === issue.group_id ? loaded : undefined;
  const handoff = {
    issueGroup: { crawlId, groupId: issue.group_id },
    prompt: askAgentPrompt(issue),
    skillId: 'technical_health',
  };
  useAgentPanelSeed(handoff);
  const pageKinds = issue.page_kinds ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width="wide"
      title={issueTitle(issue)}
      description={
        <IssueMetadata issue={issue}>
          <span className="tabular-nums">
            {issue.affected_url_count} {issue.affected_url_count === 1 ? 'page' : 'pages'} affected
          </span>
          {pageKinds.length > 0 ? <span>{pageKinds.map(pageKindLabel).join(', ')}</span> : null}
        </IssueMetadata>
      }
      footer={
        // A later page that failed keeps the pager, so the reader can still
        // step back to the pages that loaded.
        detail || canPrevious ? (
          // The retained page keeps its `next_cursor` while the next one is in
          // flight, so a second click would push the SAME cursor onto the
          // stack and Previous would need two presses to undo one: `busy`
          // holds both steps until the page lands.
          <Pager
            hideWhenSinglePage
            canPrev={canPrevious}
            canNext={Boolean(detail?.next_cursor)}
            onPrev={onPrevious}
            onNext={onNext}
            busy={detailQuery.isFetching}
          />
        ) : null
      }
    >
      {/* The rule's description is phrased as the PASSING state ("Page is not
          blocked from indexing…"); printed under a failing title it read as a
          contradiction. The fix is what the reader came for, so it leads. */}
      {issue.remediation ? (
        <Stack gap="tight" className="min-w-0">
          <span className="type-caption">How to fix</span>
          <p className={textRole('itemTitle', 'whitespace-pre-line')}>{issue.remediation}</p>
        </Stack>
      ) : null}
      <Inline className="flex-wrap">
        <AskAgentLink appearance="primary" handoff={handoff} />
        <CopyButton value={buildFixPrompt(issue)} variant="secondary" className="w-fit">
          Copy fix prompt
        </CopyButton>
      </Inline>
      <IssueFixActions scope={scope} crawlId={crawlId} groupId={issue.group_id} />
      <Stack as="section" gap="workspace" aria-busy={detailQuery.isFetching || undefined}>
        <h3 className={textRole('sectionTitle')}>Affected pages</h3>
        <OccurrenceList
          issue={issue}
          detail={detail}
          crawlId={crawlId}
          query={detailQuery}
          firstPage={!canPrevious}
        />
      </Stack>
    </Dialog>
  );
}

/**
 * An issue the address names that no listed row describes (another tab, page
 * or a stale link), before its own read has answered: loading, or why it
 * could not load, with a retry. Closing it clears the selection.
 */
export function PendingIssueDialog({
  detailQuery,
  onClose,
}: Readonly<{ detailQuery: UseQueryResult<SiteIssueDetail>; onClose: () => void }>) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width="wide"
      title="Issue"
    >
      {detailQuery.isError ? (
        <ReadError
          error={detailQuery.error}
          fallback="Could not load this issue."
          onRetry={() => void detailQuery.refetch()}
          pending={detailQuery.isFetching}
        />
      ) : (
        <QueryState kind="loading" label="Loading the issue…" />
      )}
    </Dialog>
  );
}

/** What to ask the agent about an issue: across its pages, or on one page. */
export function askAgentPrompt(
  issue: Pick<SiteIssue, 'title' | 'rule_id' | 'affected_url_count'>,
  page?: string,
): string {
  const count = issue.affected_url_count;
  const pages = count === 1 ? 'page' : 'pages';
  const scope = page ? ` on ${page}` : ` (${count} affected ${pages})`;
  return page
    ? `Analyze the Site Health issue "${issueTitle(issue)}"${scope} and propose exact page edits from the selected evidence.`
    : `Analyze the Site Health issue "${issueTitle(issue)}"${scope}, prioritize the work and propose a bounded implementation plan from the supplied sample; say how many pages it covers versus the total.`;
}

const OCCURRENCE_PLACEHOLDERS = ['first', 'second', 'third'] as const;

function OccurrenceList({
  issue,
  detail,
  crawlId,
  query,
  firstPage,
}: Readonly<{
  issue: IssueHead;
  detail: SiteIssueDetail | undefined;
  crawlId: string;
  query: UseQueryResult<SiteIssueDetail>;
  /** No earlier page of occurrences was paged past. */
  firstPage: boolean;
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
      <ul aria-busy="true" className={ledgerClasses()}>
        {OCCURRENCE_PLACEHOLDERS.map((placeholder) => (
          <Stack as="li" gap="item" key={placeholder} className={ledgerItemClasses()}>
            <Skeleton />
            <Skeleton />
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
  // Grouping sees only the loaded page of occurrences. The loaded rows are
  // the whole list only when nothing was paged past and nothing follows.
  const complete = firstPage && !detail.next_cursor;
  const loaded = loadedPageCount(detail.occurrences);
  return (
    <ul className={ledgerClasses()}>
      {groupOccurrences(detail.occurrences).map((entry) =>
        entry.kind === 'page' ? (
          <PageOccurrence
            key={entry.occurrence.occurrence_id}
            issue={issue}
            occurrence={entry.occurrence}
            crawlId={crawlId}
          />
        ) : (
          <SharedOccurrences
            key={entry.key}
            issue={issue}
            entry={entry}
            crawlId={crawlId}
            scope={{
              pageCount: entry.pageCount,
              loadedPageCount: loaded,
              totalPageCount: detail.affected_url_count,
              complete,
            }}
          />
        ),
      )}
    </ul>
  );
}

/** Evidence found on one page only: the page, what it lacks, and a question about it. */
function PageOccurrence({
  issue,
  occurrence,
  crawlId,
}: Readonly<{ issue: IssueHead; occurrence: IssueOccurrence; crawlId: string }>) {
  return (
    <Stack as="li" gap="tight" className={ledgerItemClasses()}>
      <AffectedPageLink
        crawlId={crawlId}
        siteUrlId={occurrence.site_url_id}
        title={occurrence.title}
        url={occurrence.display_url}
        pageKind={occurrence.page_kind}
      />
      <IssueEvidence occurrence={occurrence} />
      <AskAgentLink
        appearance="text"
        handoff={{
          issueGroup: { crawlId, groupId: issue.group_id, siteUrlId: occurrence.site_url_id },
          prompt: askAgentPrompt(issue, occurrence.display_url),
          skillId: 'technical_health',
        }}
      >
        Ask agent about this page
      </AskAgentLink>
    </Stack>
  );
}

function SiteLevelList({
  evidence,
  crawlId,
}: Readonly<{ evidence: SiteLevelEvidence; crawlId: string }>) {
  if (evidence.kind === 'page_kinds') {
    return (
      <ul className={ledgerClasses()}>
        {evidence.pageKinds.map((row) => (
          <Inline
            as="li"
            key={row.pageKind}
            className={ledgerItemClasses('flex-wrap justify-between')}
          >
            <span className={textRole('itemTitle')}>{pageKindLabel(row.pageKind)}</span>
            <span className="type-caption tabular-nums">
              {row.pageCount} {row.pageCount === 1 ? 'page' : 'pages'}
            </span>
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
        <ul className={ledgerClasses()}>
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
      <ul className={ledgerClasses()}>
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
    <ul className={ledgerClasses()}>
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

/** A fix prompt any assistant or developer can act on, from the rule's own words. */
export function buildFixPrompt(
  issue: Pick<
    SiteIssue,
    'title' | 'rule_id' | 'dimension' | 'severity' | 'finding_class' | 'description' | 'remediation'
  >,
): string {
  const rating =
    issue.finding_class === 'defect' ? `${severityLabel(issue.severity)} severity` : 'advisory';
  const lines = [
    `Fix this Site Health issue on my website: "${issueTitle(issue)}" (${dimensionLabel(issue.dimension)}, ${rating}).`,
  ];
  if (issue.description) lines.push('', 'The check passes when:', issue.description);
  if (issue.remediation) lines.push('', 'Recommended remediation:', issue.remediation);
  return lines.join('\n');
}
