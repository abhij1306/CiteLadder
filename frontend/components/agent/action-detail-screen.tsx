import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { ActionDock } from '@/components/agent/action-dock';
import { ActionFacts } from '@/components/agent/action-facts';
import {
  Checklist,
  Labelled,
  Prose,
  READING_SECTION_TITLE,
  ReadingColumn,
  ReadingTools,
} from '@/components/ui/reading-page';
import { ActionUrls } from '@/components/agent/action-urls';
import { ContentGapWhy, contentGapMembers } from '@/components/agent/content-gap-evidence';
import { DeclarationStatus } from '@/components/agent/declaration-status';
import { DeveloperTicketButton } from '@/components/agent/developer-ticket';
import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { PageFrame } from '@/components/templates/page-frame';
import { CopyButton } from '@/components/ui/copy-button';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { listCrumbs, type FromAction } from '@/lib/agent/action-crumbs';
import { actionTarget, withShortTarget } from '@/lib/agent/action-title';
import { actionHandoffHref } from '@/lib/agent/handoff';
import { issueFamilyBrief, type IssueFamilyBrief } from '@/lib/agent/issue-family-brief';
import { actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { isNotFound } from '@/lib/api/errors';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { formatCount } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';

export function ActionDetailScreen() {
  const { actionId = '' } = useParams();
  const { workspaceId, projectId } = useProjectScope();
  const query = useQuery({
    ...actionsQueries.detail(workspaceId, actionId),
    enabled: Boolean(actionId),
  });
  const fallback = (body: ReactNode) => (
    <PageFrame>
      <ReadingColumn>{body}</ReadingColumn>
    </PageFrame>
  );
  if (isNotFound(query.error)) return <NotFoundScreen />;
  if (query.isError)
    return fallback(
      <StateBlock
        kind="error"
        {...readErrorProps(query)}
        title="Couldn't load this Action"
        fallback="This Action could not be loaded."
      />,
    );
  if (!query.data)
    return fallback(<StateBlock kind="loading" shape={{ kind: 'facts', rows: 5 }} />);
  if (query.data.project_id !== projectId)
    return fallback(<Notice tone="negative">This Action belongs to another project.</Notice>);
  // Keyed so ticks and a decision's state never outlive their Action.
  return <ActionPage key={query.data.id} action={query.data} workspaceId={workspaceId} />;
}

function ActionPage({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const title = actionTarget(action);
  const from: FromAction = {
    id: action.id,
    title,
    status: action.status,
    goal: action.goal,
    grouping: action.grouping,
  };
  const placement = action.target_kind === 'earned_page';
  const suggested = action.origin === 'agent' ? 'Suggested by the agent' : null;
  const brief = useIssueFamilyBrief(action, workspaceId);
  const todo = brief?.steps ?? steps(action);
  const gaps = contentGapMembers(action);
  const tick = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <PageFrame title={title} trail={listCrumbs(from)}>
      <ReadingColumn>
        <Labelled title="Overview" caption={suggested}>
          <Prose>{brief?.overview ?? withShortTarget(action.handoff.message, action)}</Prose>
        </Labelled>
        <ReadingTools>
          <CopyButton value={actionPrompt(action, todo)}>Copy as prompt</CopyButton>
          {placement ? null : <DeveloperTicketButton action={action} />}
        </ReadingTools>
        <ActionFacts action={action} />
        {gaps.length > 0 ? (
          <Labelled title={placement ? 'Competitor evidence' : 'Why this matters'}>
            <ContentGapWhy members={gaps} />
          </Labelled>
        ) : null}
        {brief ? (
          <Labelled title="Why this matters">
            <Prose>{brief.why}</Prose>
          </Labelled>
        ) : null}
        {todo.length > 0 ? (
          <Labelled title="What to do">
            <Checklist items={todo} />
          </Labelled>
        ) : null}
        <ActionUrls
          action={action}
          workspaceId={workspaceId}
          from={from}
          ticked={ticked}
          onTick={tick}
        />
        {action.declaration ? (
          <Labelled title="Implementation">
            <DeclarationStatus
              declaration={action.declaration}
              workspaceId={workspaceId}
              titleRole={READING_SECTION_TITLE}
            />
          </Labelled>
        ) : null}
      </ReadingColumn>
      <ActionDock
        action={action}
        workspaceId={workspaceId}
        agentHref={actionHandoffHref(action, [...ticked])}
        agentLabel={agentLabel(action, ticked.size)}
      />
    </PageFrame>
  );
}

export function agentLabel(
  action: Pick<ActionDetail, 'target_kind' | 'page_count'>,
  ticked: number,
): string {
  if (ticked > 0) return `Fix ${formatCount(ticked)} selected with Agent`;
  if (action.target_kind === 'earned_page') return 'Draft email with Agent';
  if (action.target_kind === 'issue_family' && action.page_count)
    return `Fix all ${formatCount(action.page_count)} with Agent`;
  return 'Work with Agent';
}

function useIssueFamilyBrief(action: ActionDetail, workspaceId: string): IssueFamilyBrief | null {
  const cohort = action.cohort;
  const issue = useQuery({
    ...siteHealthQueries.issue(workspaceId, cohort?.crawl_id ?? '', cohort?.group_id ?? ''),
    enabled: Boolean(cohort),
  });
  if (!cohort) return null;
  const loaded = issue.data?.group_id === cohort.group_id ? issue.data : undefined;
  return issueFamilyBrief({
    cohort,
    grouping: action.grouping,
    fix: action.summary ?? action.members[0]?.remediation ?? null,
    issue: loaded,
  });
}

function steps(action: ActionDetail): string[] {
  return [...new Set(action.members.map((member) => member.remediation).filter(Boolean))];
}

function actionPrompt(action: ActionDetail, todo: readonly string[]): string {
  if (todo.length === 0) return action.handoff.message;
  const lines = todo.map((step, index) => `${index + 1}. ${step}`);
  return [action.handoff.message, '', 'What to do:', ...lines].join('\n');
}
