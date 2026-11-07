'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';

import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { promptsMutations } from '@/lib/api/prompts';
import type { PromptGenerateRequest } from '@citeladder/contracts/prompt-requests';
import { humanizeApiError } from '@/lib/api/errors';
import { topicsQueries } from '@/lib/api/topics';
import type { Prompt, PromptStatus, Topic } from '@citeladder/contracts';
import {
  emptyFilters,
  filterPrompts,
  personaOptions,
  type PromptFilters,
} from '@/lib/prompts/filter';
import {
  formValuesToPromptInput,
  formValuesToPromptUpdate,
  type PromptFormValues,
} from '@/lib/prompts/forms';
import { usePromptCandidates } from '@/lib/prompts/use-prompt-candidates';
import { usePromptSet } from '@/lib/prompts/use-prompt-set';

import { PendingReviewNotice } from './candidate-review';
import { PromptEmptyState } from './prompt-empty-state';
import type { PendingDelete } from './confirm-delete-dialog';
import { PromptLibraryDialogs } from './prompt-library-dialogs';
import { PromptTable } from './prompt-table';
import { useLatestPromptMeasurements } from './use-latest-prompt-measurements';
import { ListScreen, RESERVED_CONTROLS } from '@/components/layout/page-shell';

import { PromptActions, promptFilterControls } from './prompt-toolbar';
import { type TopicDialog, TopicDialogs, TopicFilter } from './topic-controls';
import { useTopicMutations } from './use-topic-mutations';
import { useActiveProject, useActiveWorkspaceId } from '@/lib/project/project-context';

import type { BuilderStep } from './prompt-builder';
import { resolveProjectRequestScope } from '@/lib/project/request-scope';

function mutationErrorMessage(
  create: { isError: boolean; error: unknown },
  update: { isError: boolean; error: unknown },
): string | undefined {
  if (create.isError) return humanizeApiError(create.error).message;
  return update.isError ? humanizeApiError(update.error).message : undefined;
}

/**
 * Whether the library still shows its first-load frame. Prompts often arrive
 * with the project, before the latest run's figures; a run adds four columns,
 * and adding them beside rows already on screen moved every cell sideways.
 */
function awaitingFirstLoad(
  state: Readonly<{ promptsLoading: boolean; hasPrompts: boolean; figuresRead: boolean }>,
): boolean {
  return state.promptsLoading || (state.hasPrompts && !state.figuresRead);
}

/**
 * Prompt library client. Owns the active prompt set (via the project
 * context), the topic/status/search filter state, and every CRUD, import,
 * lifecycle, and AI-generation mutation. Layout: one control row (Active /
 * Archived, search, Topic, filters) over the prompt table at the page's full
 * width; topics are added, renamed and deleted from the Topic menu's dialogs
 * (owner, 2026-11-06). "Prompt Builder" opens the sheet that steers
 * generation and reviews its suggestions.
 */
// react-doctor-disable-next-line react-doctor/no-giant-component -- this component only orchestrates queries/mutations; toolbar, topic rail, table, empty state, and dialogs are extracted.
export function PromptLibrary({
  generateRequest = 0,
  reviewRequest = false,
}: Readonly<{
  /** Increments once per URL request to open the Prompt Builder. */
  generateRequest?: number;
  reviewRequest?: boolean;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const { projectId, promptSet, prompts, isLoading, error, ensurePromptSet, retry, retrying } =
    usePromptSet();
  const requestScope = resolveProjectRequestScope(workspaceId, projectId);
  const scope = { workspaceId: requestScope.workspaceId, projectId: requestScope.projectId };

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PromptFilters>(emptyFilters);
  const [statusFilter, setStatusFilter] = useState<PromptStatus>('active');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState<BuilderStep>('business');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [topicDialog, setTopicDialog] = useState<TopicDialog | null>(null);
  const hasCompetitors = (useActiveProject()?.competitors.length ?? 0) > 0;

  const topicsQuery = useQuery({
    ...topicsQueries.list(scope),
    enabled: requestScope.enabled,
  });
  const topics: Topic[] = useMemo(() => topicsQuery.data ?? [], [topicsQuery.data]);
  const measurements = useLatestPromptMeasurements(requestScope);

  const review = usePromptCandidates({
    projectId: scope.projectId,
    promptSet,
    workspaceId: scope.workspaceId,
    onAccepted: () => {
      setStatusFilter('active');
      // Show every newly tracked prompt, whichever topic it landed in.
      setSelectedTopicId(null);
    },
  });

  // Every descriptor refreshes the library's reads; these add the screen's own reaction.
  const closeForm = () => {
    setFormOpen(false);
    setEditing(undefined);
  };
  const clearBusy = { onSettled: () => setBusyId(null) };
  const createMutation = useMutation(promptsMutations.create(scope, ensurePromptSet));
  const updateMutation = useMutation(promptsMutations.update(scope));
  const deleteMutation = useMutation(promptsMutations.remove(scope));
  const rowMutation = useMutation(promptsMutations.update(scope));
  const importMutation = useMutation(promptsMutations.import(scope, ensurePromptSet));

  // A retry of the same request after a failure reuses its key, so a run the
  // server already staged is replayed instead of drafted (and paid for) again.
  const generateKey = useRef<{ request: string; key: string } | null>(null);
  const generateMutation = useMutation(promptsMutations.generate(scope, ensurePromptSet));
  const generatePrompts = async (input: PromptGenerateRequest) => {
    const request = JSON.stringify(input);
    if (generateKey.current?.request !== request)
      generateKey.current = { request, key: crypto.randomUUID() };
    const result = await generateMutation
      .mutateAsync({ input, idempotencyKey: generateKey.current.key })
      .catch(() => null);
    if (result === null) return null;
    // Only this request's key retires; a different pending request keeps its own.
    if (generateKey.current?.request === request) generateKey.current = null;
    review.clearNotice();
    return result;
  };
  // A fresh open clears the last run's outcome, but never a run still in
  // flight: resetting it would drop `isPending` and allow a second paid run.
  const openBuilder = (step: BuilderStep) => {
    if (!generateMutation.isPending) generateMutation.reset();
    setBuilderStep(step);
    setBuilderOpen(true);
  };
  const openFromUrl = useEffectEvent((step: BuilderStep) => openBuilder(step));
  useEffect(() => {
    if (generateRequest === 0) return;
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- open the builder for a URL request.
    openFromUrl(reviewRequest ? 'review' : 'business');
  }, [generateRequest, reviewRequest]);

  const topicMutations = useTopicMutations({
    scope,
    onDeleted: (topic) => {
      if (selectedTopicId === topic.id) setSelectedTopicId(null);
    },
  });

  // A fresh Add topic starts without the last attempt's error.
  const openAddTopic = () => {
    topicMutations.create.reset();
    setTopicDialog('add');
  };

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const confirmDelete = (pending: PendingDelete) => {
    if (pending.kind === 'topic') return topicMutations.remove.mutate(pending.topic);
    setBusyId(pending.prompt.id);
    deleteMutation.mutate(pending.prompt.id, clearBusy);
  };

  // Status -> topic -> search/filters, preserving order.
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
    () => filterPrompts(byTopic, search, filters),
    [byTopic, search, filters],
  );
  const personas = useMemo(() => personaOptions(prompts), [prompts]);

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

  if (!requestScope.enabled) {
    return (
      <ListScreen>
        <ProjectRequiredState />
      </ListScreen>
    );
  }

  // An empty library and a library filtered to nothing read differently: one
  // needs a way to add prompts, the other needs its filter loosened.
  let libraryBody: ReactNode = (
    <PromptTable
      prompts={visible}
      onEdit={openEdit}
      onDelete={(prompt) => setPendingDelete({ kind: 'prompt', prompt })}
      onToggleEnabled={(prompt) => {
        setBusyId(prompt.id);
        rowMutation.mutate({ promptId: prompt.id, input: { enabled: !prompt.enabled } }, clearBusy);
      }}
      onSetStatus={(prompt, status) => {
        setBusyId(prompt.id);
        rowMutation.mutate({ promptId: prompt.id, input: { status } }, clearBusy);
      }}
      busyId={busyId}
      measurements={measurements}
    />
  );
  // A failed read with nothing to show takes the empty state's slot; a failed
  // refresh keeps the prompts already shown and says so above them.
  const failedEmpty = Boolean(error) && !hasPrompts;
  if (failedEmpty) {
    libraryBody = (
      <QueryState
        kind="error"
        error={error}
        fallback="Could not load prompts. Check your connection and try again."
        onRetry={retry}
        pending={retrying}
      />
    );
  } else if (!hasPrompts) {
    libraryBody = <PromptEmptyState onGenerate={() => openBuilder('business')} onAdd={openAdd} />;
  }

  // Status, search and filters share one control band once loaded; the first
  // load holds it so the table starts where the box stood.
  const figuresRead = measurements !== undefined;
  if (awaitingFirstLoad({ promptsLoading: isLoading, hasPrompts, figuresRead })) {
    return (
      <ListScreen controls={RESERVED_CONTROLS}>
        <QueryState kind="loading" />
      </ListScreen>
    );
  }

  return (
    <ListScreen
      actions={
        <PromptActions
          onImport={() => setImportOpen(true)}
          onAdd={openAdd}
          onGenerate={() => openBuilder('business')}
          hasActivePrompts={statusCounts.active > 0}
        />
      }
      controls={promptFilterControls({
        status: { value: statusFilter, counts: statusCounts, onChange: setStatusFilter },
        search,
        onSearchChange: setSearch,
        filters,
        onFiltersChange: setFilters,
        personas,
        topic: (
          <TopicFilter
            topics={topics}
            selectedTopicId={selectedTopicId}
            onSelect={setSelectedTopicId}
            onAdd={openAddTopic}
            onManage={() => setTopicDialog('manage')}
          />
        ),
      })}
    >
      <>
        {error && !failedEmpty ? (
          <ReadError
            error={error}
            fallback="Could not load prompts. Check your connection and try again."
            onRetry={retry}
            pending={retrying}
          />
        ) : null}
        <PendingReviewNotice
          count={review.candidates.length}
          hidden={builderOpen}
          onReview={() => openBuilder('review')}
        />

        <TopicDialogs
          dialog={topicDialog}
          onDialogChange={setTopicDialog}
          topics={topics}
          mutations={topicMutations}
          loadError={topicsQuery.isError}
          onAdd={openAddTopic}
          onDelete={(topic) => setPendingDelete({ kind: 'topic', topic })}
        />
        {libraryBody}

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
          formError={mutationErrorMessage(createMutation, updateMutation)}
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
            importMutation.isError ? humanizeApiError(importMutation.error).message : undefined
          }
          projectId={requestScope.projectId}
          workspaceId={requestScope.workspaceId}
          builderOpen={builderOpen}
          setBuilderOpen={setBuilderOpen}
          builderStep={builderStep}
          hasCompetitors={hasCompetitors}
          topics={topics}
          selectedTopicId={selectedTopicId}
          generatePrompts={generatePrompts}
          isGenerating={generateMutation.isPending}
          generateError={generateMutation.isError ? generateMutation.error : undefined}
          review={review}
          setsLoading={isLoading}
          setsError={error !== null}
          retrySets={retry}
        />
      </>
    </ListScreen>
  );
}
