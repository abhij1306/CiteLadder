import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { RecordPage } from '@/components/templates/record-page';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { marketFilter } from '@/components/visibility/visibility-toolbar';
import { ArchiveRestore } from '@/lib/icons';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { httpErrorStatus } from '@/lib/api/errors';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { promptsMutations } from '@/lib/api/prompts';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { useProjectMarkets } from '@/lib/project/use-project-markets';

import { usePromptAnswerFilters } from './prompt-answer-filters';
import { PromptEngineCoverage, PromptKeyFigures } from './prompt-figures';
import { PromptPastAnswers } from './prompt-past-answers';
import { PromptImplementations, PromptTrend } from './prompt-trend';

export function PromptDetailScreen() {
  const { promptId = '' } = useParams();
  const { workspaceId, projectId } = useProjectScope();
  const [market, setMarket] = useUrlState('market', optionalStringUrlCodec);
  const markets = useProjectMarkets(projectId, workspaceId);
  const marketChoice = marketFilter({ markets, market, onChangeMarket: setMarket });
  const answerFilters = usePromptAnswerFilters({ market, marketChoice });
  const query = useQuery({
    ...visibilityQueries.promptHistory({ workspaceId, projectId }, promptId, {
      market: market ?? undefined,
      engine: answerFilters.engine ?? undefined,
    }),
    enabled: Boolean(promptId),
  });

  const filters = <FilterBar filters={answerFilters.definitions} />;
  if (httpErrorStatus(query.error) === 404) return <NotFoundScreen />;
  if (query.isError)
    return (
      <RecordPage filters={filters}>
        <StateBlock
          kind="error"
          {...readErrorProps(query)}
          title="Couldn't load this prompt"
          fallback="The request failed or timed out."
        />
      </RecordPage>
    );
  if (!query.data)
    return (
      <RecordPage filters={filters}>
        <StateBlock
          kind="loading"
          label="Loading this prompt…"
          shape={{ kind: 'figures', count: 4 }}
        />
      </RecordPage>
    );
  const history = query.data;
  const actionId = history.latest?.action_id ?? null;
  return (
    <RecordPage
      title={history.prompt.text}
      actions={actionId ? <ActionHandoff actionId={actionId} /> : undefined}
      filters={filters}
      identity={
        history.prompt.status === 'archived' ? (
          <ArchivedNotice promptId={history.prompt.id} onRestored={() => void query.refetch()} />
        ) : undefined
      }
    >
      {history.points.length ? (
        <PromptKeyFigures history={history} />
      ) : (
        <StateBlock
          kind="empty"
          inline
          message="No run has asked this prompt in this market yet."
        />
      )}
      <PromptPastAnswers
        key={JSON.stringify(answerFilters.answers)}
        promptId={history.prompt.id}
        promptText={history.prompt.text}
        params={answerFilters.answers}
        markets={markets}
      />
      {history.points.length ? (
        <>
          <PromptTrend history={history} />
          <PromptEngineCoverage latest={history.latest} />
        </>
      ) : null}
      <PromptImplementations history={history} />
    </RecordPage>
  );
}

function ActionHandoff({ actionId }: Readonly<{ actionId: string }>) {
  return (
    <>
      <ActionButton action="openAction" href={`/actions/${actionId}`} />
      <ActionButton action="workWithAgent" href={agentHandoffHref({ actionId })} />
    </>
  );
}

function ArchivedNotice({
  promptId,
  onRestored,
}: Readonly<{ promptId: string; onRestored: () => void }>) {
  const { workspaceId, projectId } = useProjectScope();
  const canWrite = useWorkspaceCapability('write');
  const restore = useMutation(promptsMutations.update({ workspaceId, projectId }));
  return (
    <Stack gap="compact">
      <Notice
        tone="warning"
        title="Archived"
        action={
          canWrite ? (
            <Button
              variant="secondary"
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate({ promptId, input: { status: 'active' } }, { onSuccess: onRestored })
              }
            >
              <Icon icon={ArchiveRestore} />
              Restore
            </Button>
          ) : undefined
        }
      >
        Runs no longer ask this prompt.
      </Notice>
      {restore.error ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(restore.error, { action: 'restore the prompt' })}
        />
      ) : null}
    </Stack>
  );
}
