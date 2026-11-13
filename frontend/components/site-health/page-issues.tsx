import { useRef, useState, type Ref } from 'react';

import { AskAgentLink } from '@/components/agent/ask-agent-link';
import { askAgentPrompt, buildFixPrompt } from '@/components/site-health/issue-detail-dialog';
import { IssueEvidence } from '@/components/site-health/issue-evidence';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { AppGrid } from '@/components/ui/app-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Inline, Stack } from '@/components/ui/layout';
import { OpenRow } from '@/components/ui/list-row';
import { Pager } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses, SubsectionHeader } from '@/components/ui/workspace';
import type { PageIssue } from '@citeladder/contracts';
import { scoreRoleLabels, severityRank } from '@/lib/site-health/issues';

/** Issues the list shows before "View all". */
const PREVIEW_COUNT = 5;
/** Issue cards side by side in the details. */
const CARDS_PER_VIEW = 2;

/** Re-audits the page; omitted for a role that may not run one. */
export type RerunControl = Readonly<{ onRerun: () => void; busy: boolean }>;

/**
 * A page's findings, in the order a site owner works through them: every
 * issue on one numbered list, worst first, then the issues one or two at a
 * time with what to do about each, then the advisories apart. Choosing an
 * issue in the list brings its card into view.
 */
export function PageIssues({
  issues,
  audited,
  crawlId,
  rerun,
}: Readonly<{
  issues: readonly PageIssue[];
  /** No issues before the audit finishes means "not checked yet", not "clean". */
  audited: boolean;
  crawlId: string;
  rerun?: RerunControl;
}>) {
  const defects = issues
    .filter((issue) => issue.finding_class === 'defect')
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const advisories = issues.filter((issue) => issue.finding_class !== 'defect');
  const [start, setStart] = useState(0);
  const details = useRef<HTMLDivElement>(null);
  const show = (index: number) => {
    setStart(index - (index % CARDS_PER_VIEW));
    details.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>All issues ({defects.length})</CardTitle>
        </CardHeader>
        <CardContent>
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
            <IssueList issues={defects} onSelect={show} />
          )}
        </CardContent>
      </Card>
      {defects.length > 0 ? (
        <IssueDetails
          ref={details}
          issues={defects}
          start={Math.min(start, defects.length - 1)}
          onStart={setStart}
          crawlId={crawlId}
          rerun={rerun}
        />
      ) : null}
      {advisories.length > 0 ? <Advisories advisories={advisories} /> : null}
    </>
  );
}

/** The numbered list: the first few, then all of them on request. */
function IssueList({
  issues,
  onSelect,
}: Readonly<{ issues: readonly PageIssue[]; onSelect: (index: number) => void }>) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? issues : issues.slice(0, PREVIEW_COUNT);
  return (
    <Stack gap="item">
      <ol className={ledgerClasses()}>
        {shown.map((issue, index) => (
          <li key={issue.occurrence_id} className={ledgerItemClasses()}>
            <OpenRow
              number={index + 1}
              title={issue.issue_title}
              meta={<IssueMetadata issue={issue} />}
              onOpen={() => onSelect(index)}
            />
          </li>
        ))}
      </ol>
      {issues.length > PREVIEW_COUNT ? (
        <Button variant="ghost" className="w-fit" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer issues' : `View all ${issues.length} issues`}
        </Button>
      ) : null}
    </Stack>
  );
}

/** The issues as cards, two at a time, with their place in the list. */
function IssueDetails({
  ref,
  issues,
  start,
  onStart,
  crawlId,
  rerun,
}: Readonly<{
  ref: Ref<HTMLDivElement>;
  issues: readonly PageIssue[];
  start: number;
  onStart: (start: number) => void;
  crawlId: string;
  rerun?: RerunControl;
}>) {
  const shown = issues.slice(start, start + CARDS_PER_VIEW);
  return (
    <Stack
      as="section"
      gap="item"
      ref={ref}
      aria-labelledby="page-issue-details"
      className="scroll-mt-24"
    >
      <Inline className="flex-wrap justify-between">
        <h2 id="page-issue-details" className={textRole('sectionTitle')}>
          Issue details
        </h2>
        <Pager
          hideWhenSinglePage
          range={{
            from: start + 1,
            to: start + shown.length,
            total: issues.length,
            noun: 'issues',
          }}
          canPrev={start > 0}
          canNext={start + CARDS_PER_VIEW < issues.length}
          onPrev={() => onStart(Math.max(0, start - CARDS_PER_VIEW))}
          onNext={() => onStart(start + CARDS_PER_VIEW)}
        />
      </Inline>
      <AppGrid layout="pair">
        {shown.map((issue, offset) => (
          <IssueCard
            key={issue.occurrence_id}
            issue={issue}
            position={start + offset + 1}
            total={issues.length}
            crawlId={crawlId}
            rerun={rerun}
          />
        ))}
      </AppGrid>
    </Stack>
  );
}

/**
 * One issue on this page: how severe, what it is, how to fix it, what the
 * crawl saw, which scores it holds down, and the three ways to act on it.
 */
function IssueCard({
  issue,
  position,
  total,
  crawlId,
  rerun,
}: Readonly<{
  issue: PageIssue;
  position: number;
  total: number;
  crawlId: string;
  rerun?: RerunControl;
}>) {
  const head = { ...issue, title: issue.issue_title, affected_url_count: 1 };
  const scores = scoreRoleLabels(issue.score_roles);
  return (
    <Card aria-label={issue.issue_title}>
      <Stack gap="compact">
        <Inline className="flex-wrap justify-between">
          <IssueMetadata issue={issue} />
          <span className="type-caption tabular-nums">
            {position}/{total}
          </span>
        </Inline>
        <h3 className={textRole('itemTitle')}>{issue.issue_title}</h3>
        {issue.remediation ? (
          <p className="type-body text-ink whitespace-pre-line">{issue.remediation}</p>
        ) : null}
        <IssueEvidence occurrence={issue} />
        {scores.length > 0 ? (
          <Inline as="p" className="flex-wrap">
            <span className="type-caption">Counts toward</span>
            {scores.map((score) => (
              <Badge key={score}>{score}</Badge>
            ))}
          </Inline>
        ) : null}
        <Inline className="flex-wrap">
          <AskAgentLink
            handoff={{
              issueGroup: { crawlId, groupId: issue.group_id, siteUrlId: issue.site_url_id },
              prompt: askAgentPrompt(head, issue.display_url),
              skillId: 'technical_health',
            }}
          />
          <CopyButton value={buildFixPrompt(head)} variant="secondary" className="w-fit">
            Copy fix prompt
          </CopyButton>
          {rerun ? (
            <Button variant="ghost" onClick={rerun.onRerun} disabled={rerun.busy}>
              Re-audit to verify
            </Button>
          ) : null}
        </Inline>
      </Stack>
    </Card>
  );
}

/** Recommendations, labelled as the catalog labels them, never with a severity. */
function Advisories({ advisories }: Readonly<{ advisories: readonly PageIssue[] }>) {
  return (
    <Card>
      <CardContent>
        <Stack as="section" gap="item">
          <SubsectionHeader
            title={`Advisories (${advisories.length})`}
            description="Recommendations to consider."
          />
          <ol className={ledgerClasses()}>
            {advisories.map((issue) => (
              <Stack as="li" gap="tight" key={issue.occurrence_id} className={ledgerItemClasses()}>
                <Inline className="flex-wrap items-start justify-between">
                  <span className={textRole('itemTitle', 'min-w-0')}>{issue.issue_title}</span>
                  <Badge>Advisory</Badge>
                </Inline>
                <IssueEvidence occurrence={issue} />
                {issue.remediation ? (
                  <p className="type-body text-ink whitespace-pre-line">{issue.remediation}</p>
                ) : null}
              </Stack>
            ))}
          </ol>
        </Stack>
      </CardContent>
    </Card>
  );
}
