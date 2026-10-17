'use client';

import { ProjectLink } from '@/components/layout/scoped-link';

import { Badge } from '@/components/ui/badge';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { ReadError } from '@/components/ui/read-error';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { BusyBar } from '@/components/ui/busy-bar';
import { CopyButton } from '@/components/ui/copy-button';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { Pager } from '@/components/ui/pager';
import { panelClasses } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
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
    <section
      className="min-w-0 lg:sticky lg:top-[var(--workspace-gap)] lg:max-h-[calc(100dvh-2*var(--workspace-gap))] lg:overflow-hidden"
      aria-busy={detailQuery.isFetching}
    >
      <div className="relative flex flex-col lg:max-h-[calc(100dvh-2*var(--workspace-gap))]">
        <BusyBar active={detailQuery.isFetching} label="Updating issue evidence" />
        <header className="border-border-subtle grid min-w-0 shrink-0 gap-3 border-b p-[var(--card-padding)]">
          <div className="flex min-w-0 items-start justify-between gap-[var(--workspace-gap)] max-[700px]:flex-col">
            <div className="grid min-w-0 gap-2">
              <h2 className={textRole('sectionTitle')}>{issueTitle(issue)}</h2>
              <IssueMetadata issue={issue} />
            </div>
            <div
              className={textRole(
                'body',
                'border-border-subtle grid shrink-0 gap-1 border-l pl-4 max-[700px]:w-full max-[700px]:border-t max-[700px]:border-l-0 max-[700px]:pt-3 max-[700px]:pl-0',
              )}
            >
              <span className="text-secondary whitespace-nowrap tabular-nums">
                {issue.affected_url_count} {issue.affected_url_count === 1 ? 'page' : 'pages'}{' '}
                affected
              </span>
              {issue.page_kinds.length > 0 ? (
                <span className="type-caption flex max-w-56 flex-wrap items-center gap-1">
                  <span>Affects</span>
                  {issue.page_kinds.map((kind, index) => (
                    <span key={kind} className="contents">
                      {index > 0 ? <span aria-hidden>·</span> : null}
                      <span>{pageKindLabel(kind)}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
          <IssueActions issue={issue} crawlId={crawlId} />
        </header>
        <div className="content-scroll grid min-h-0 gap-[var(--workspace-gap)] p-[var(--card-padding)] lg:flex-1 lg:overflow-y-auto">
          {issue.description ? (
            <p className="type-body whitespace-pre-line">{issue.description}</p>
          ) : null}
          {issue.remediation ? (
            <div className={panelClasses({ tone: 'tonal', pad: 'compact' }, 'grid gap-1')}>
              <span className={textRole('label')}>How to fix</span>
              <p className="type-body whitespace-pre-line">{issue.remediation}</p>
            </div>
          ) : null}
          <Stack as="section">
            <h3 className={textRole('itemTitle')}>Affected pages</h3>
            <OccurrenceList issue={issue} detail={detail} crawlId={crawlId} query={detailQuery} />
          </Stack>
        </div>
        {detail ? (
          // The retained page keeps its `next_cursor` while the next one is in
          // flight, so a second click would push the SAME cursor onto the
          // stack and Previous would need two presses to undo one: `busy`
          // holds both steps until the page lands.
          <Pager
            frame="table"
            hideWhenSinglePage
            className="bg-panel shrink-0"
            canPrev={canPrevious}
            canNext={Boolean(detail.next_cursor)}
            onPrev={onPrevious}
            onNext={onNext}
            busy={detailQuery.isFetching}
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * Every issue gets an action: the fix prompt a developer or assistant can use,
 * and Ask agent, which starts a chat about it in the Agent workspace.
 */
function IssueActions({ issue, crawlId }: Readonly<{ issue: SiteIssue; crawlId: string }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" asChild>
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
      <CopyButton value={buildFixPrompt(issue)} size="sm" variant="secondary" className="w-fit">
        Copy fix prompt
      </CopyButton>
    </div>
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
          <li key={placeholder} className="grid gap-2 p-3">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </li>
        ))}
      </ul>
    );
  }
  if (detail.occurrences.length === 0) return <InlineEmpty>No affected URLs found.</InlineEmpty>;
  return (
    <ul className={ledgerClasses('open')}>
      {detail.occurrences.map((occurrence) => (
        <li key={occurrence.occurrence_id} className="grid gap-3 p-3">
          <TextLink
            text="inherit"
            className="flex min-w-0 flex-col gap-0.5"
            href={`/site/crawls/${crawlId}/pages/${occurrence.site_url_id}`}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
                {pageDisplayTitle(occurrence.title, occurrence.display_url)}
              </span>
              {occurrence.page_kind ? <Badge>{pageKindLabel(occurrence.page_kind)}</Badge> : null}
            </span>
            <span
              className="type-caption [overflow-wrap:anywhere] tabular-nums"
              title={occurrence.display_url}
            >
              {occurrence.display_url}
            </span>
          </TextLink>
          <IssueEvidence occurrence={occurrence} />
          <Button variant="ghost" size="sm" asChild className="w-fit">
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
        </li>
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
