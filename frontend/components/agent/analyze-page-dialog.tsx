import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Prompt, Topic } from '@citeladder/contracts';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ChecklistField } from '@/components/ui/checklist-field';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { MutationNotice } from '@/components/ui/mutation-notice';
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

/**
 * Analyze a page (CO6): the Actions header's button and its dialog. Pick one
 * of the latest crawl's content pages, a topic that has prompts and the
 * prompts to optimize the page for; Generate action creates or reuses the
 * page's Action and opens the new chat, which reads the live page first.
 */
export function AnalyzePageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Analyze a page
      </Button>
      {/* Mounted only while open, so each opening starts from empty choices. */}
      {open ? <AnalyzePageDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type TopicChoice = Readonly<{ topic: Topic; prompts: readonly Prompt[] }>;

function AnalyzePageDialog({ onClose }: Readonly<{ onClose: () => void }>) {
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
    // Every prompt of the topic starts selected.
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
      description="Pick a page and the prompts it should answer."
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
      {access.canSend ? null : <Callout tone="info">{access.message}</Callout>}
      {analyze.isError ? (
        <MutationNotice notice={agentWriteFailure(analyze.error, 'start the analysis')} />
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

/**
 * The project's topics that hold active prompts, each with those prompts,
 * from the same reads as the Prompts screen.
 */
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

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ANALYZE_PAGE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** A page's path as a reader reads it; the whole address when it cannot be parsed. */
function pagePath(url: string) {
  try {
    const parsed = new URL(url);
    return readableUrl(`${parsed.pathname}${parsed.search}`);
  } catch {
    return readableUrl(url);
  }
}

/**
 * The content page, searched on the server: the latest crawl's content pages
 * whose address or title matches, at most the server's cap. The picked page
 * stays an option while a later search leaves it out.
 */
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
  const searched = useDebounced(search);
  const query = useQuery({
    ...actionsQueries.analyzablePages(scope, searched),
    // A new search keeps the last matches on screen until its own land.
    placeholderData: (previous) => previous,
  });
  const items = query.data?.items ?? [];
  const pages =
    page && !items.some((item) => item.site_url_id === page.site_url_id) ? [page, ...items] : items;
  if (query.isPending) return <EmptyState variant="inline" title="Loading your content pages…" />;
  if (query.isError)
    return <Callout tone="negative">Your content pages could not be loaded.</Callout>;
  if (query.data.crawl_id === null)
    return (
      <EmptyState
        variant="inline"
        title="No crawl yet"
        description="Analyze a page reads the content pages of your latest crawl. Run a crawl in Site Health first."
      />
    );
  if (pages.length === 0 && search.trim() === '')
    return (
      <EmptyState
        variant="inline"
        title="No content pages"
        description="Your latest crawl found no articles, guides or other content pages."
      />
    );
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
  if (truncated) return `Showing the first ${count} matches. Search to narrow them.`;
  return count === 0 ? 'No content pages match this search.' : undefined;
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
  if (state === 'loading') return <EmptyState variant="inline" title="Loading your topics…" />;
  if (state === 'error') return <Callout tone="negative">Your topics could not be loaded.</Callout>;
  if (choices.length === 0)
    return (
      <EmptyState
        variant="inline"
        title="No topics with prompts"
        description="Add prompts to a topic on the Prompts page first."
      />
    );
  return (
    <Field label="Topic" hint="Only topics with prompts are listed.">
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
      help="The page is improved to answer these prompts."
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
