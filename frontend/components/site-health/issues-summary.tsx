import type { UseQueryResult } from '@tanstack/react-query';

import { fixedLabel } from '@/components/site-health/issue-fix-actions';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { Card } from '@/components/ui/card';
import { OpenRow } from '@/components/ui/list-row';
import { DonutChart } from '@/components/ui/donut-chart';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { InlineFigure, textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { IssueFixProgress, SiteIssue, SiteIssuesPage } from '@citeladder/contracts';
import { formatCount } from '@/lib/format';
import { issueTitle, severityCount } from '@/lib/site-health/issues';

/**
 * The top of the Issues screen: how many issues the crawl has, how many are
 * high severity, and the few to fix first. It reads the crawl's unfiltered
 * defects, so it never changes as the list below is searched or filtered.
 */
export function IssuesSummary({
  query,
  fixes = [],
  onOpen,
}: Readonly<{
  /** The crawl's worst defects, unfiltered; its summary counts the whole crawl. */
  query: UseQueryResult<SiteIssuesPage>;
  /** How far each issue's fix has come; an issue with none fixed shows no line. */
  fixes?: readonly IssueFixProgress[];
  onOpen: (groupId: string) => void;
}>) {
  if (query.isError && !query.data)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load the issue summary."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (!query.data) return <QueryState kind="loading" label="Loading the issue summary…" />;
  const { summary, items } = query.data;
  const total = summary.defect_issue_type_count;
  const high = severityCount(summary.severity_counts, 'high');
  const slices = [
    { name: 'High', value: high },
    { name: 'Medium', value: severityCount(summary.severity_counts, 'medium') },
    { name: 'Low', value: severityCount(summary.severity_counts, 'low') },
  ];
  return (
    <Card>
      <Stack gap="workspace">
        <Inline gap="workspace" className="flex-wrap justify-between">
          <Stack gap="tight" className="min-w-0 flex-[1_1_20rem]">
            <h2 className={textRole('pageTitle')}>{outstandingHeadline(total)}</h2>
            <p className={textRole('body', 'text-ink-secondary')}>{attentionLine(high, summary)}</p>
          </Stack>
          {total > 0 ? (
            <DonutChart
              // Wide enough for the donut's container to keep the legend beside it.
              className="flex-[0_1_28rem]"
              slices={slices}
              totalLabel={total === 1 ? 'Issue' : 'Issues'}
              label="Issues by severity"
            />
          ) : null}
        </Inline>
        {items.length > 0 ? <FixFirst issues={items} fixes={fixes} onOpen={onOpen} /> : null}
      </Stack>
    </Card>
  );
}

function outstandingHeadline(total: number): string {
  if (total === 0) return 'You have no outstanding issues';
  return `You have ${formatCount(total)} outstanding ${total === 1 ? 'issue' : 'issues'}`;
}

/** How many need attention now, and the pages the issues reach. */
function attentionLine(high: number, summary: SiteIssuesPage['summary']): string {
  const pages = summary.affected_url_count;
  const reach = `They affect ${formatCount(pages)} ${pages === 1 ? 'page' : 'pages'}.`;
  if (summary.defect_issue_type_count === 0) return 'This crawl found nothing to fix.';
  if (high === 0) return `None is high severity. ${reach}`;
  const need = high === 1 ? '1 issue needs' : `${formatCount(high)} issues need`;
  return `${need} attention first: they hold back how search and answer engines read your site. ${reach}`;
}

/** The first sentence of a rule's fix, so a priority line stays one line of advice. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/u.exec(text.trim());
  return (match ? match[0] : text).trim();
}

/** The worst issues, worst first, each opening its own detail. */
function FixFirst({
  issues,
  fixes,
  onOpen,
}: Readonly<{
  issues: readonly SiteIssue[];
  fixes: readonly IssueFixProgress[];
  onOpen: (groupId: string) => void;
}>) {
  const fixOf = new Map(fixes.map((fix) => [fix.group_id, fix]));
  return (
    <Stack as="section" gap="item" aria-labelledby="issues-fix-first">
      <h3 id="issues-fix-first" className={textRole('sectionTitle')}>
        Fix these first
      </h3>
      <ol className={ledgerClasses()}>
        {issues.map((issue) => {
          const fix = fixOf.get(issue.group_id);
          return (
            <li key={issue.group_id} className={ledgerItemClasses()}>
              <OpenRow
                onOpen={() => onOpen(issue.group_id)}
                title={issueTitle(issue)}
                meta={
                  <IssueMetadata issue={issue}>
                    <span className="tabular-nums">
                      <InlineFigure>{formatCount(issue.affected_url_count)}</InlineFigure>{' '}
                      {issue.affected_url_count === 1 ? 'page' : 'pages'}
                    </span>
                    {fix && fix.fixed_url_count > 0 ? (
                      <span className="tabular-nums">{fixedLabel(fix)}</span>
                    ) : null}
                  </IssueMetadata>
                }
                caption={issue.remediation ? firstSentence(issue.remediation) : null}
              />
            </li>
          );
        })}
      </ol>
    </Stack>
  );
}
