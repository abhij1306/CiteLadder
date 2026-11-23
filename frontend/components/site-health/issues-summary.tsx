import type { UseQueryResult } from '@tanstack/react-query';

import { fixedLabel } from '@/components/site-health/issue-fix-actions';
import { IssueSeverityMark } from '@/components/site-health/issue-metadata';
import { FigureStrip } from '@/components/ui/figure-strip';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import { ROWS_SHELL } from '@/components/ui/work-rows';
import { IssuesSummaryLoading } from '@/components/site-health/issues-summary-loading';
import type { IssueFixProgress, SiteIssue, SiteIssuesPage } from '@citeladder/contracts';
import { ChevronRight } from '@/lib/icons';
import { formatCount } from '@/lib/format';
import { firstSentence, issueTitle, severityCount } from '@/lib/site-health/issues';
import { cn } from '@/lib/utils';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { READ_FAILED } from '@/components/ui/state-block';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';

export function IssuesSummary({
  query,
  fixes = [],
  onOpen,
}: Readonly<{
  query: UseQueryResult<SiteIssuesPage>;
  fixes?: readonly IssueFixProgress[];
  onOpen: (groupId: string) => void;
}>) {
  if (query.isError && !query.data)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        fallback={READ_FAILED}
        title="Couldn't load the issue summary"
      />
    );
  if (!query.data) return <IssuesSummaryLoading />;
  const { summary, items } = query.data;
  return (
    <Stack gap="workspace" className="min-w-0">
      <SeverityCard summary={summary} />
      {items.length > 0 ? <FixFirst issues={items} fixes={fixes} onOpen={onOpen} /> : null}
    </Stack>
  );
}

function SeverityCard({ summary }: Readonly<{ summary: SiteIssuesPage['summary'] }>) {
  const figure = (key: string, label: string, value: number) => ({
    key,
    label,
    value: formatCount(value),
  });
  return (
    <FigureStrip
      label="Issue summary"
      segments={[
        figure('types', 'Issue types', summary.issue_count),
        figure('pages', 'Pages affected', summary.affected_url_count),
        ...SEVERITIES.map((severity) =>
          figure(
            severity.key,
            severity.label,
            severityCount(summary.severity_counts, severity.key),
          ),
        ),
      ]}
    />
  );
}

const SEVERITIES = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
] as const;

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
    <Section aria-labelledby="issues-fix-first">
      <SectionHeader>
        <SectionTitle id="issues-fix-first">Fix these first</SectionTitle>
      </SectionHeader>
      <ol className={cn(ROWS_SHELL, 'divide-rule m-0 list-none divide-y p-0')}>
        {issues.map((issue) => {
          const fix = fixOf.get(issue.group_id);
          return (
            <li key={issue.group_id}>
              <Pressable
                onClick={() => onOpen(issue.group_id)}
                className="hover:overlay-hover phone:flex-wrap phone:gap-y-1 phone:py-2 flex min-h-10 w-full min-w-0 items-center gap-2 px-4 text-start"
              >
                <span
                  className={textRole(
                    'body',
                    'phone:basis-full phone:whitespace-normal min-w-0 shrink truncate',
                  )}
                >
                  {issueTitle(issue)}
                </span>
                <span
                  className={textRole('body', 'text-ink-2 phone:hidden min-w-0 flex-1 truncate')}
                >
                  {issue.remediation ? firstSentence(issue.remediation) : null}
                </span>
                {fix && fix.fixed_url_count > 0 ? (
                  <span className={textRole('body', 'text-ink-2 shrink-0 tabular-nums')}>
                    {fix.fixed_url_count >= fix.affected_url_count &&
                    fix.verified_url_count < fix.affected_url_count
                      ? 'Marked fixed, awaiting re-audit'
                      : fixedLabel(fix)}
                  </span>
                ) : null}
                <span className="ms-auto flex shrink-0">
                  <IssueSeverityMark issue={issue} />
                </span>
                <span className={textRole('body', 'text-ink-2 shrink-0 tabular-nums')}>
                  {formatCount(issue.affected_url_count)}{' '}
                  {issue.affected_url_count === 1 ? 'page affected' : 'pages affected'}
                </span>
                <Icon icon={ChevronRight} className="text-ink-2 shrink-0" />
              </Pressable>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
