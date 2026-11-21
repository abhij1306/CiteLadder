import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Prompt, Topic } from '@citeladder/contracts';

import { Button } from '@/components/ui/button';
import { ChecklistField } from '@/components/ui/checklist-field';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select } from '@/components/ui/select';
import { agentWriteFailure } from '@/lib/agent/errors';
import { useRequestKey } from '@/lib/agent/idempotency';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import { actionsMutations, actionsQueries, type AnalyzablePage } from '@/lib/api/actions';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { promptsQueries } from '@/lib/api/prompts';
import { topicsQueries } from '@/lib/api/topics';
import { ANALYZE_PAGE_SEARCH_DEBOUNCE_MS } from '@/lib/config/agent';
import { readableUrl } from '@/lib/format';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useDebounced } from '@/lib/use-debounced';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Spinner } from '@/components/ui/spinner';

type TopicChoice = Readonly<{ topic: Topic; prompts: readonly Prompt[] }>;

export function AnalyzePageDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { workspaceId, projectId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const [page, setPage] = useState<AnalyzablePage | null>(null);
  const [topicId, setTopicId] = useState('');
  const [promptIds, setPromptIds] = useState<ReadonlySet<string>>(new Set());
  const topics = useTopicChoices(scope);
  const access = useAgentAccess();
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const requestKey = useRequestKey();
  const analyze = useMutation(actionsMutations.analyze(scope));
  const topic = topics.choices.find((choice) => choice.topic.id === topicId) ?? null;
  const ready = access.canSend && page !== null && topic !== null && promptIds.size > 0;

  const pickTopic = (id: string) => {
    setTopicId(id);
    const prompts = topics.choices.find((choice) => choice.topic.id === id)?.prompts ?? [];
    setPromptIds(new Set(prompts.map((prompt) => prompt.id)));
  };
  const generate = () => {
    if (!ready || !page || !topic) return;
    const input = {
      site_url_id: page.site_url_id,
      topic_id: topic.topic.id,
      prompt_ids: [...promptIds],
    };
    analyze.mutate(
      { input, idempotencyKey: requestKey.keyFor({ projectId, input }) },
      {
        onSuccess: (started) => {
          requestKey.accepted();
          navigate(projectHref(`/agent/chats/${started.chat_id}`));
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !analyze.isPending) onClose();
      }}
      title="Analyze a page"
      footer={
        <>
          <Button onClick={onClose} disabled={analyze.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={generate}
            disabled={!ready}
            pending={analyze.isPending}
          >
            Generate action
          </Button>
        </>
      }
    >
      {access.canSend ? null : <Notice tone="info">{access.message}</Notice>}
      {analyze.isError ? (
        <Notice kind="mutation" notice={agentWriteFailure(analyze.error, 'start the analysis')} />
      ) : null}
      <PageField scope={scope} page={page} onPick={setPage} />
      <TopicField
        choices={topics.choices}
        state={topics.state}
        value={topicId}
        onPick={pickTopic}
      />
      {topic ? (
        <PromptsField
          prompts={topic.prompts}
          selected={promptIds}
          onToggle={(id) =>
            setPromptIds((current) => {
              const next = new Set(current);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
        />
      ) : null}
    </Dialog>
  );
}

function useTopicChoices(scope: ProjectScope) {
  const topicsQuery = useQuery(topicsQueries.list(scope));
  const setsQuery = useQuery(promptsQueries.sets(scope));
  const choices = useMemo<TopicChoice[]>(() => {
    const prompts = (setsQuery.data?.prompt_sets ?? []).flatMap((set) => set.prompts);
    return (topicsQuery.data ?? []).flatMap((topic) => {
      const held = prompts.filter(
        (prompt) => prompt.topic_id === topic.id && prompt.status === 'active',
      );
      return held.length > 0 ? [{ topic, prompts: held }] : [];
    });
  }, [topicsQuery.data, setsQuery.data]);
  let state: 'loading' | 'error' | 'ready' = 'ready';
  if (topicsQuery.isPending || setsQuery.isPending) state = 'loading';
  else if (topicsQuery.isError || setsQuery.isError) state = 'error';
  return { choices, state };
}

function pagePath(url: string) {
  try {
    const parsed = new URL(url);
    return readableUrl(`${parsed.pathname}${parsed.search}`);
  } catch {
    return readableUrl(url);
  }
}

function PageField({
  scope,
  page,
  onPick,
}: Readonly<{
  scope: ProjectScope;
  page: AnalyzablePage | null;
  onPick: (page: AnalyzablePage) => void;
}>) {
  const [search, setSearch] = useState('');
  const searched = useDebounced(search, ANALYZE_PAGE_SEARCH_DEBOUNCE_MS);
  const query = useQuery({
    ...actionsQueries.analyzablePages(scope, searched),
    placeholderData: (previous) => previous,
  });
  const items = query.data?.items ?? [];
  const pages =
    page && !items.some((item) => item.site_url_id === page.site_url_id) ? [page, ...items] : items;
  if (query.isPending) return <Spinner label="Loading your content pages…" showLabel />;
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load your content pages"
        fallback="Your content pages could not be loaded."
      />
    );
  if (query.data.crawl_id === null)
    return <StateBlock kind="empty" inline message="No crawl yet" />;
  if (pages.length === 0 && search.trim() === '')
    return <StateBlock kind="empty" inline message="No content pages in your latest crawl." />;
  return (
    <Field label="Page" hint={pageHint(items.length, query.data.truncated)}>
      {(control) => (
        <SearchableSelect
          id={control.id}
          aria-describedby={control['aria-describedby']}
          ariaLabel="Page"
          placeholder="Search by title or address"
          value={page?.site_url_id ?? ''}
          options={pages.map((item) => ({
            value: item.site_url_id,
            label: item.title || pagePath(item.url),
            detail: pagePath(item.url),
          }))}
          onSearchChange={setSearch}
          onChange={(id) => {
            const picked = pages.find((item) => item.site_url_id === id);
            if (picked) onPick(picked);
          }}
        />
      )}
    </Field>
  );
}

function pageHint(count: number, truncated: boolean) {
  if (truncated) return `First ${count} matches`;
  return count === 0 ? 'No matches.' : undefined;
}

function TopicField({
  choices,
  state,
  value,
  onPick,
}: Readonly<{
  choices: readonly TopicChoice[];
  state: 'loading' | 'error' | 'ready';
  value: string;
  onPick: (id: string) => void;
}>) {
  if (state === 'loading') return <Spinner label="Loading your topics…" showLabel />;
  if (state === 'error') return <Notice tone="negative">Your topics could not be loaded.</Notice>;
  if (choices.length === 0)
    return (
      <StateBlock
        kind="empty"
        inline
        message={
          <>
            <span className="type-emphasis">No topics with prompts</span> Add prompts to a topic on
            the Prompts page first.
          </>
        }
      />
    );
  return (
    <Field label="Topic">
      {(control) => (
        <Select
          {...control}
          ariaLabel="Topic"
          placeholder="Choose a topic"
          value={value}
          onValueChange={onPick}
          options={choices.map((choice) => ({
            value: choice.topic.id,
            label: choice.topic.name,
            detail: String(choice.prompts.length),
          }))}
        />
      )}
    </Field>
  );
}

function PromptsField({
  prompts,
  selected,
  onToggle,
}: Readonly<{
  prompts: readonly Prompt[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}>) {
  return (
    <ChecklistField
      label="Prompts"
      count={`${selected.size} of ${prompts.length}`}
      note={selected.size === 0 ? 'Choose at least one prompt.' : undefined}
      items={prompts.map((prompt) => ({
        id: prompt.id,
        label: prompt.text,
        checked: selected.has(prompt.id),
      }))}
      onToggle={onToggle}
      empty="This topic has no prompts."
    />
  );
}
