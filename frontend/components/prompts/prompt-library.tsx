import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { promptsMutations } from '@/lib/api/prompts';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { mutationNoticeForError, type MutationNotice } from '@/lib/api/mutation-notice';
import { topicsQueries } from '@/lib/api/topics';
import type { Prompt, PromptStatus, Topic } from '@citeladder/contracts';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import {
  brandOptions,
  emptyFilters,
  filterPrompts,
  personaOptions,
  sourceOptions,
  type PromptFilters,
} from '@/lib/prompts/filter';
import {
  formValuesToPromptInput,
  formValuesToPromptUpdate,
  type PromptFormValues,
} from '@/lib/prompts/forms';
import { PROMPT_BUILDER_HREF } from '@/lib/prompts/routes';
import { useRowSelection } from '@/lib/prompts/selection';
import { usePromptSet } from '@/lib/prompts/use-prompt-set';

import { PendingReviewNotice, usePendingReview } from './candidate-review';
import { PromptEmptyState } from './prompt-empty-state';
import type { PendingDelete } from './confirm-delete-dialog';
import { PromptLibraryDialogs } from './prompt-library-dialogs';
import { usePromptEvidence, type PromptAnswerRef } from './prompt-evidence';
import { PromptBulkBar, usePromptBulk } from './prompt-bulk-bar';
import { PromptTable } from './prompt-table';
import {
  measurementsOf,
  useLatestPromptMeasurements,
  type PromptMeasurements,
} from './use-latest-prompt-measurements';
import { ReportPage } from '@/components/templates/report-page';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';

import { PromptActions, PromptStatusTabs, promptFilterControls } from './prompt-toolbar';
import { HeldTabRow, TabPanel, TabsRoot } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { type TopicDialog, TopicDialogs, topicFilter } from './topic-controls';
import { useTopicMutations } from './use-topic-mutations';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

function mutationFailure(
  create: { isError: boolean; error: unknown },
  update: { isError: boolean; error: unknown },
): MutationNotice | undefined {
  if (create.isError) return mutationNoticeForError(create.error, { action: 'add the prompt' });
  return update.isError
    ? mutationNoticeForError(update.error, { action: 'save the prompt' })
    : undefined;
}

function usePromptToggle(scope: ProjectScope) {
  const mutation = useMutation(promptsMutations.setEnabled(scope));
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const settle = (id: string) =>
    setSaving((current) => new Set([...current].filter((other) => other !== id)));
  const press = (prompt: Prompt) => {
    if (saving.has(prompt.id)) return;
    setSaving((current) => new Set(current).add(prompt.id));
    void mutation
      .mutateAsync({ promptId: prompt.id, enabled: !prompt.enabled })
      .catch(() => undefined)
      .finally(() => settle(prompt.id));
  };
  return { press, mutation };
}

function topicNamesOf(topics: readonly Topic[] | undefined) {
  return topics && new Map(topics.map((topic) => [topic.id, topic.name]));
}

function topicsLoadError<Read extends RetryableRead & { isError: boolean }>(
  read: Read,
  pageFailed: boolean,
): Read | null {
  return read.isError && !pageFailed ? read : null;
}

function clearWhenNarrowed(tabRows: number, clear: () => void) {
  return tabRows ? clear : undefined;
}

function ToggleFailure({ toggle }: Readonly<{ toggle: { isError: boolean; error: unknown } }>) {
  if (!toggle.isError) return null;
  return (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(toggle.error, { action: 'turn the prompt on or off' })}
    />
  );
}

function FiguresFailure({ measurements }: Readonly<{ measurements: PromptMeasurements }>) {
  if (measurements.kind !== 'failed') return null;
  return (
    <Notice
      kind="read"
      {...readErrorProps(measurements.read)}
      title="Couldn't load the prompts' latest figures"
      fallback="Couldn't load the prompts' latest figures"
    />
  );
}

const ROW_CHANGE_FAILED = {
  active: 'restore this prompt',
  archived: 'archive this prompt',
} as const satisfies Record<PromptStatus, string>;

function awaitingFirstLoad(
  state: Readonly<{
    promptsLoading: boolean;
    hasPrompts: boolean;
    figuresRead: boolean;
    reviewRead: boolean;
  }>,
): boolean {
  return state.promptsLoading || (state.hasPrompts && !state.figuresRead) || !state.reviewRead;
}

const promptStatusCodec = stringUrlCodec<PromptStatus>(['active', 'archived'], 'active');
const STATUS_LABELS = { active: 'Active', archived: 'Archived' } satisfies Record<
  PromptStatus,
  string
>;
const PAGE_KEYS = ['page'];

function libraryBodyFor({
  failedEmpty,
  hasPrompts,
  read,
  add,
  table,
}: Readonly<{
  failedEmpty: boolean;
  hasPrompts: boolean;
  read: Pick<ReturnType<typeof usePromptSet>, 'error' | 'retry' | 'retrying'>;
  add: ComponentProps<typeof PromptEmptyState>['add'];
  table: ReactNode;
}>): ReactNode {
  if (failedEmpty)
    return (
      <StateBlock
        kind="error"
        error={read.error}
        title="Couldn't load the prompts"
        fallback="The request failed or timed out."
        onRetry={read.retry}
        pending={read.retrying}
      />
    );
  return hasPrompts ? table : <PromptEmptyState add={add} />;
}

function measuredChoicesFor({
  measurements,
  project,
  filters,
}: Readonly<{
  measurements: ReturnType<typeof measurementsOf>;
  project: Parameters<typeof brandOptions>[0];
  filters: PromptFilters;
}>) {
  if (!measurements?.size && !filters.brands.length && !filters.sources.length) return undefined;
  return {
    brands: brandOptions(project),
    sources: sourceOptions(measurements?.values() ?? [], filters.sources),
  };
}

function libraryFilterBar(hasPrompts: boolean, controls: FilterBarProps): ReactNode {
  return hasPrompts ? <FilterBar {...controls} /> : undefined;
}

function libraryTabs(
  hasPrompts: boolean,
  counts: ComponentProps<typeof PromptStatusTabs>['counts'],
): ReactNode {
  return hasPrompts ? <PromptStatusTabs counts={counts} /> : undefined;
}

// react-doctor-disable-next-line react-doctor/no-giant-component
export function PromptLibrary() {
  const { workspaceId, projectId, project } = useProjectScope();
  const scope = { workspaceId, projectId };
  const canWrite = useWorkspaceCapability('write');
  const {
    promptSet,
    prompts,
    setNames,
    commerceSetIds,
    limits,
    isLoading,
    error,
    ensurePromptSet,
    retry,
    retrying,
  } = usePromptSet();
  const review = usePendingReview({ scope, promptSet, hidden: !canWrite });

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PromptFilters>(emptyFilters);
  const [statusFilter, setStatusFilter] = useUrlState('status', promptStatusCodec, {
    clearKeys: PAGE_KEYS,
  });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [topicDialog, setTopicDialog] = useState<TopicDialog | null>(null);
  const navigate = useNavigate();
  const projectHref = useProjectHref();

  const topicsQuery = useQuery(topicsQueries.list(scope));
  const topics: Topic[] = useMemo(() => topicsQuery.data ?? [], [topicsQuery.data]);
  const measurements = useLatestPromptMeasurements(scope);
  const measured = measurementsOf(measurements);
  const evidence = usePromptEvidence();
  const toast = useToast();
  const failedTo = (action: string) => (error: unknown) =>
    toast.notify(`Couldn't ${action}`, mutationNoticeForError(error, { action }).message, {
      tone: 'negative',
    });

  const closeForm = () => {
    setFormOpen(false);
    setEditing(undefined);
  };
  const createMutation = useMutation(promptsMutations.create(scope, ensurePromptSet));
  const updateMutation = useMutation(promptsMutations.update(scope));
  const deleteMutation = useMutation(promptsMutations.remove(scope));
  const rowMutation = useMutation(promptsMutations.update(scope));
  const toggle = usePromptToggle(scope);
  const importMutation = useMutation(promptsMutations.import(scope, ensurePromptSet));

  const topicMutations = useTopicMutations({
    scope,
    onDeleted: (topic) => {
      if (selectedTopicId === topic.id) setSelectedTopicId(null);
    },
  });

  const openAddTopic = () => {
    topicMutations.create.reset();
    setTopicDialog('add');
  };

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const byStatus = useMemo(
    () => prompts.filter((prompt) => prompt.status === statusFilter),
    [prompts, statusFilter],
  );
  const byTopic = useMemo(
    () =>
      selectedTopicId === null
        ? byStatus
        : byStatus.filter((prompt) => prompt.topic_id === selectedTopicId),
    [byStatus, selectedTopicId],
  );
  const visible = useMemo(
    () => filterPrompts({ prompts: byTopic, search, filters, mentions: measured }),
    [byTopic, search, filters, measured],
  );
  const filterKey = JSON.stringify([selectedTopicId, search, filters]);
  const selection = useRowSelection(visible, `${statusFilter}:${filterKey}`);
  const bulk = usePromptBulk(scope, { topics, onDone: selection.clear });
  const confirmDelete = (pending: PendingDelete) => {
    switch (pending.kind) {
      case 'topic':
        return topicMutations.remove.mutate(pending.topic);
      case 'prompt':
        void deleteMutation.mutateAsync(pending.prompt.id).catch(failedTo('delete this prompt'));
        return;
      case 'prompts':
        return bulk.run({ kind: 'delete' }, pending.prompts);
      default: {
        const unhandled: never = pending;
        return unhandled;
      }
    }
  };
  const personas = useMemo(() => personaOptions(prompts), [prompts]);
  const measuredChoices = useMemo(
    () => measuredChoicesFor({ measurements: measured, project, filters }),
    [measured, project, filters],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<PromptStatus, number> = { active: 0, archived: 0 };
    for (const prompt of prompts) counts[prompt.status] += 1;
    return counts;
  }, [prompts]);

  const hasPrompts = prompts.length > 0;

  const openAdd = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (prompt: Prompt) => {
    setEditing(prompt);
    setFormOpen(true);
  };
  const submitForm = async (values: PromptFormValues) => {
    const mutation = editing
      ? updateMutation.mutateAsync({
          promptId: editing.id,
          input: formValuesToPromptUpdate(values),
        })
      : createMutation.mutateAsync(formValuesToPromptInput(values));
    await mutation.then(closeForm, () => undefined);
  };
  const addPrompts = {
    onImport: () => setImportOpen(true),
    onAdd: openAdd,
    onGenerate: () => void navigate(projectHref(PROMPT_BUILDER_HREF)),
  };
  const edits = canWrite
    ? {
        rows: {
          onEdit: openEdit,
          onDelete: (prompt: Prompt) => setPendingDelete({ kind: 'prompt', prompt }),
          onToggleEnabled: toggle.press,
          onSetStatus: (prompt: Prompt, status: PromptStatus) =>
            void rowMutation
              .mutateAsync({ promptId: prompt.id, input: { status } })
              .catch(failedTo(ROW_CHANGE_FAILED[status])),
        },
        add: addPrompts,
        topics: { onAdd: openAddTopic, onManage: () => setTopicDialog('manage') },
      }
    : undefined;

  const failedEmpty = Boolean(error) && !hasPrompts;
  const libraryBody = libraryBodyFor({
    failedEmpty,
    hasPrompts,
    read: { error, retry, retrying },
    add: edits?.add,
    table: (
      <>
        <PromptTable
          prompts={visible}
          actions={edits?.rows}
          onOpenAnswer={(prompt: Prompt, answer: PromptAnswerRef) =>
            evidence.open({ ...answer, promptId: prompt.id, promptText: prompt.text })
          }
          selection={edits ? selection : undefined}
          measurements={measured}
          resetKey={filterKey}
          setNames={setNames}
          topicNames={topicNamesOf(topicsQuery.data)}
          commerceSetIds={commerceSetIds}
          onClearFilters={clearWhenNarrowed(byStatus.length, () => {
            setSearch('');
            setFilters(emptyFilters);
            setSelectedTopicId(null);
          })}
        />
        <PromptBulkBar
          selected={selection.selected}
          topics={topics}
          max={limits?.bulk_prompts_max ?? 0}
          pending={bulk.pending}
          onClear={selection.clear}
          onChange={(change) => bulk.run(change, selection.selected)}
          onDelete={() => setPendingDelete({ kind: 'prompts', prompts: selection.selected })}
        />
      </>
    ),
  });

  const figuresRead = measurements.kind !== 'loading';
  if (
    awaitingFirstLoad({
      promptsLoading: isLoading,
      hasPrompts,
      figuresRead,
      reviewRead: review.settled,
    })
  ) {
    return (
      <ReportPage
        tabs={
          <HeldTabRow
            labels={Object.values(STATUS_LABELS)}
            selected={STATUS_LABELS[statusFilter]}
          />
        }
        filters={<FilterBar />}
      >
        <StateBlock kind="loading" label="Loading prompts…" shape={{ kind: 'table', columns: 8 }} />
      </ReportPage>
    );
  }

  return (
    <TabsRoot value={statusFilter} onValueChange={setStatusFilter}>
      <ReportPage
        actions={<PromptActions add={addPrompts} inEmptyState={!hasPrompts && !failedEmpty} />}
        tabs={libraryTabs(hasPrompts, statusCounts)}
        filters={libraryFilterBar(
          hasPrompts,
          promptFilterControls({
            search,
            onSearchChange: setSearch,
            filters,
            onFiltersChange: setFilters,
            personas,
            measured: measuredChoices,
            topic: topicFilter({
              topics,
              selectedTopicId,
              onSelect: setSelectedTopicId,
              manage: edits?.topics,
            }),
          }),
        )}
      >
        <>
          {error && !failedEmpty ? (
            <Notice
              kind="read"
              error={error}
              title="Couldn't refresh the prompts"
              fallback="The prompts below are from the last successful read."
              onRetry={retry}
              pending={retrying}
            />
          ) : null}
          {hasPrompts ? <FiguresFailure measurements={measurements} /> : null}
          <ToggleFailure toggle={toggle.mutation} />
          <PendingReviewNotice count={review.count} shown={statusFilter === 'active'} />

          <TopicDialogs
            dialog={topicDialog}
            onDialogChange={setTopicDialog}
            topics={topics}
            mutations={topicMutations}
            loadError={topicsLoadError(topicsQuery, failedEmpty)}
            onAdd={openAddTopic}
            onDelete={(topic) => setPendingDelete({ kind: 'topic', topic })}
          />
          <TabPanel value={statusFilter}>{libraryBody}</TabPanel>
          {evidence.dialog}

          <PromptLibraryDialogs
            pendingDelete={pendingDelete}
            setPendingDelete={setPendingDelete}
            confirmDelete={confirmDelete}
            formOpen={formOpen}
            setFormOpen={setFormOpen}
            editing={editing}
            setEditing={setEditing}
            submitForm={submitForm}
            isSaving={createMutation.isPending || updateMutation.isPending}
            formError={mutationFailure(createMutation, updateMutation)}
            importOpen={importOpen}
            setImportOpen={setImportOpen}
            importPrompts={async (rows) => {
              await importMutation.mutateAsync(rows).then(
                () => setImportOpen(false),
                () => undefined,
              );
            }}
            isImporting={importMutation.isPending}
            importError={
              importMutation.isError
                ? mutationNoticeForError(importMutation.error, { action: 'import the prompts' })
                : undefined
            }
            topics={topics}
            selectedTopicId={selectedTopicId}
            limits={limits}
          />
        </>
      </ReportPage>
    </TabsRoot>
  );
}
