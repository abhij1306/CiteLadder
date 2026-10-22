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
      {issue.description ? (
        <p className="type-body whitespace-pre-line">{issue.description}</p>
      ) : null}
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
  return (
    <ul className={ledgerClasses('open')}>
      {detail.occurrences.map((occurrence) => (
        <Stack as="li" key={occurrence.occurrence_id} className={ledgerItemClasses()}>
          <TextLink
            text="inherit"
            className="flex min-w-0 flex-col"
            href={`/site/crawls/${crawlId}/pages/${occurrence.site_url_id}`}
          >
            <Inline as="span" className="flex-wrap">
              <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
                {pageDisplayTitle(occurrence.title, occurrence.display_url)}
              </span>
              {occurrence.page_kind ? <Badge>{pageKindLabel(occurrence.page_kind)}</Badge> : null}
            </Inline>
            <span
              className="type-caption [overflow-wrap:anywhere] tabular-nums"
              title={occurrence.display_url}
            >
              {occurrence.display_url}
            </span>
          </TextLink>
          <IssueEvidence occurrence={occurrence} />
          <Button variant="ghost" asChild className="w-fit">
            <ProjectLink
              href={agentHandoffHref({
                issueGroup: { crawlId, groupId: issue.group_id, siteUrlId: occurrence.site_url_id },
                prompt: askAgentPrompt(issue, occurrence.display_url),
                skillId: 'technical_health',
              })}
            >
              Ask agent about this page
            </ProjectLink>
          </Button>
        </Stack>
      ))}
    </ul>
  );
}

function buildFixPrompt(issue: SiteIssue): string {
  const lines = [
    `Fix this Site Health issue on my website: "${issueTitle(issue)}" (${dimensionLabel(issue.dimension)}, ${severityLabel(issue.severity)} severity).`,
  ];
  if (issue.description) lines.push('', 'What is wrong:', issue.description);
  if (issue.remediation) lines.push('', 'Recommended remediation:', issue.remediation);
  return lines.join('\n');
}
