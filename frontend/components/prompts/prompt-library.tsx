'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { ICONS } from '@/lib/icons';
import {
  promptsApi,
  type PromptGenerateInput,
  type PromptImportRow,
  type PromptInput,
  type PromptUpdateInput,
} from '@/lib/api/prompts';
import { queryKeys } from '@/lib/api/query-keys';
import { humanizeApiError } from '@/lib/api/errors';
import { topicsApi } from '@/lib/api/topics';
import type {
  Prompt,
  PromptGenerateResponse,
  PromptSet,
  PromptStatus,
  Topic,
} from '@/lib/api/types';
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
import { Tabs } from '@/components/ui/tabs';

import { PendingReviewNotice } from './candidate-review';
import { PromptEmptyState } from './prompt-empty-state';
import type { PendingDelete } from './confirm-delete-dialog';
import { PromptLibraryDialogs } from './prompt-library-dialogs';
import { PromptTable } from './prompt-table';
import { useLatestPromptMeasurements } from './use-latest-prompt-measurements';
import { PageShell } from '@/components/layout/page-shell';
import { Stack } from '@/components/ui/layout';
import { ResizableSplitPane } from '@/components/ui/split-pane';

import { PromptActions, promptFilterControls } from './prompt-toolbar';
import { TopicRail } from './topic-rail';
import { useTopicMutations } from './use-topic-mutations';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { resolveProjectRequestScope } from '@/lib/project/request-scope';

function mutationErrorMessage(
  create: { isError: boolean; error: unknown },
  update: { isError: boolean; error: unknown },
): string | undefined {
  if (create.isError) return humanizeApiError(create.error).message;
  return update.isError ? humanizeApiError(update.error).message : undefined;
}

/** The topic rail's widths, in px: the default, its bounds, and the room the library keeps. */
const RAIL_DEFAULT_WIDTH = 240;
const RAIL_MIN_WIDTH = 208;
const RAIL_MAX_WIDTH = 400;
const LIBRARY_MIN_WIDTH = 572;
const RAIL_SEPARATOR_LABEL = 'Resize topics panel';

const STATUS_TABS: { id: PromptStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
];

/**
 * Prompt library client. Owns the active prompt set (via the project
 * context), the topic/status/search filter state, and every CRUD, import,
 * lifecycle, and AI-generation mutation. Layout: topics rail on the left;
 * Active / Archived status tabs over the prompt table on the
 * right. The desktop split is user-resizable; "Generate prompts"
 * opens the consent-gated AI dialog.
 */
// react-doctor-disable-next-line react-doctor/no-giant-component -- this component only orchestrates queries/mutations; toolbar, topic rail, table, empty state, and dialogs are extracted.
export function PromptLibrary({
  generateRequest = 0,
  reviewRequest = false,
}: Readonly<{
  /** Increments once per URL request to open the Generate dialog. */
  generateRequest?: number;
  reviewRequest?: boolean;
}>) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const { projectId, promptSet, prompts, isLoading, error, ensurePromptSet, retry, retrying } =
    usePromptSet();
  const requestScope = resolveProjectRequestScope(workspaceId, projectId);
  const requestOptions = () => {
    if (!requestScope.enabled) throw new Error('Project is not available.');
    return { workspaceId: requestScope.workspaceId };
  };

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PromptFilters>(emptyFilters);
  const [statusTab, setStatusTab] = useState<PromptStatus>('active');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [generateResult, setGenerateResult] = useState<PromptGenerateResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const topicsQuery = useQuery({
    queryKey: queryKeys.topics.list(requestScope.projectId),
    queryFn: ({ signal }) =>
      topicsApi.list(requestScope.projectId, { signal, ...requestOptions() }),
    enabled: requestScope.enabled,
  });
  const topics: Topic[] = useMemo(() => topicsQuery.data ?? [], [topicsQuery.data]);
  const measurements = useLatestPromptMeasurements(requestScope);

  const invalidate = async () => {
    if (projectId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.sets(projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.topics.list(projectId),
      });
    }
    if (promptSet)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.set(promptSet.id),
      });
    // The projects list embeds prompt_sets[].prompts, which the onboarding
    // "Getting Started" card reads to mark the "Add prompts" step done. Refresh
    // it so adding prompts (via generate, manual, or import) advances the flow.
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  };

  const review = usePromptCandidates({
    promptSet,
    workspaceId: requestScope.workspaceId,
    onReviewed: async () => {
      setStatusTab('active');
      // Show every newly tracked prompt, whichever topic it landed in.
      setSelectedTopicId(null);
      await invalidate();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: PromptInput) => {
      const options = requestOptions();
      const set = await ensurePromptSet();
      return promptsApi.createPrompt(set.id, input, options);
    },
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(undefined);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; input: PromptUpdateInput }) =>
      promptsApi.updatePrompt(vars.id, vars.input, requestOptions()),
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => promptsApi.deletePrompt(id, requestOptions()),
    onSettled: () => setBusyId(null),
    onSuccess: invalidate,
  });

  const toggleMutation = useMutation({
    mutationFn: (prompt: Prompt) =>
      promptsApi.updatePrompt(prompt.id, { enabled: !prompt.enabled }, requestOptions()),
    onSettled: () => setBusyId(null),
    onSuccess: invalidate,
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { prompt: Prompt; status: PromptStatus }) =>
      promptsApi.updatePrompt(vars.prompt.id, { status: vars.status }, requestOptions()),
    onSettled: () => setBusyId(null),
    onSuccess: invalidate,
  });

  const importMutation = useMutation({
    mutationFn: async (rows: PromptImportRow[]): Promise<PromptSet> => {
      const options = requestOptions();
      const set = await ensurePromptSet();
      return promptsApi.importRows(set.id, rows, options);
    },
    onSuccess: async () => {
      await invalidate();
      setImportOpen(false);
    },
  });

  // A retry of the same request after a failure reuses its key, so a run the
  // server already staged is replayed instead of drafted (and paid for) again.
  const generateKey = useRef<{ request: string; key: string } | null>(null);
  const generateMutation = useMutation({
    mutationFn: async (input: PromptGenerateInput) => {
      const options = requestOptions();
      const set = await ensurePromptSet();
      const request = JSON.stringify(input);
      if (generateKey.current?.request !== request)
        generateKey.current = { request, key: crypto.randomUUID() };
      return promptsApi.generate(set.id, input, {
        ...options,
        idempotencyKey: generateKey.current.key,
      });
    },
    // Clear any prior success summary before a new attempt so a stale result
    // can never render alongside a later retry's error.
    onMutate: () => setGenerateResult(null),
    onSuccess: async (result, input) => {
      // Only this request's key retires; a different pending request keeps its own.
      if (generateKey.current?.request === JSON.stringify(input)) generateKey.current = null;
      setGenerateResult(result);
      review.clearNotice();
      // Candidates are reviewed in the dialog; topics may have been created.
      await review.refresh();
      await invalidate();
    },
    // A failed response can still follow a completed run (a dropped connection
    // after staging), so the review list is re-read rather than assumed empty.
    onError: () => void review.refresh(),
  });
  const { reset: resetGenerate } = generateMutation;
  useEffect(() => {
    if (generateRequest === 0) return;
    resetGenerate();
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- open the dialog for a URL request.
    setGenerateResult(null);
    setGenerateOpen(true);
    setReviewOnly(reviewRequest);
  }, [generateRequest, reviewRequest, resetGenerate]);

  const topicMutations = useTopicMutations({
    projectId: requestScope.projectId,
    requestOptions,
    invalidate,
    onDeleted: (topic) => {
      if (selectedTopicId === topic.id) setSelectedTopicId(null);
    },
  });

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const confirmDelete = (pending: PendingDelete) => {
    if (pending.kind === 'topic') return topicMutations.remove.mutate(pending.topic);
    setBusyId(pending.prompt.id);
    deleteMutation.mutate(pending.prompt.id);
  };

  // Status tab -> topic -> search/filters, preserving order.
  const byStatus = useMemo(
    () => prompts.filter((prompt) => prompt.status === statusTab),
    [prompts, statusTab],
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
      ? updateMutation.mutateAsync({ id: editing.id, input: formValuesToPromptUpdate(values) })
      : createMutation.mutateAsync(formValuesToPromptInput(values));
    await mutation.catch(() => undefined);
  };

  if (!requestScope.enabled) {
    return (
      <PageShell>
        <ProjectRequiredState />
      </PageShell>
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
        toggleMutation.mutate(prompt);
      }}
      onSetStatus={(prompt, status) => {
        setBusyId(prompt.id);
        statusMutation.mutate({ prompt, status });
      }}
      busyId={busyId}
      measurements={measurements}
      topics={topics}
    />
  );
  const openGenerateDialog = () => {
    setReviewOnly(false);
    setGenerateResult(null);
    generateMutation.reset();
    setGenerateOpen(true);
  };
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
    libraryBody = <PromptEmptyState onGenerate={openGenerateDialog} onAdd={openAdd} />;
  } else if (visible.length === 0) {
    libraryBody = (
      <QueryState
        kind="empty"
        icon={ICONS.prompts}
        heading="No prompts match your search or filters."
      />
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <QueryState kind="loading" />
      </PageShell>
    );
  }

  return (
    <PageShell
      actions={
        <PromptActions
          onImport={() => setImportOpen(true)}
          onAdd={openAdd}
          onGenerate={openGenerateDialog}
          hasActivePrompts={statusCounts.active > 0}
        />
      }
      controls={promptFilterControls({
        search,
        onSearchChange: setSearch,
        filters,
        onFiltersChange: setFilters,
        personas,
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
          hidden={generateOpen}
          onReview={() => {
            openGenerateDialog();
            setReviewOnly(true);
          }}
        />

        <ResizableSplitPane
          listId="prompt-topic-rail"
          separatorLabel={RAIL_SEPARATOR_LABEL}
          defaultWidth={RAIL_DEFAULT_WIDTH}
          minWidth={RAIL_MIN_WIDTH}
          maxWidth={RAIL_MAX_WIDTH}
          minDetailWidth={LIBRARY_MIN_WIDTH}
          stickyList
          list={
            <TopicRail
              topics={topics}
              selectedTopicId={selectedTopicId}
              onSelect={setSelectedTopicId}
              onCreate={async (name, parentId) => {
                await topicMutations.create.mutateAsync({ name, parentId });
              }}
              onDelete={(topic) => setPendingDelete({ kind: 'topic', topic })}
              onRename={async (topic, name) => {
                await topicMutations.rename.mutateAsync({ topic, name });
              }}
              isCreating={topicMutations.create.isPending}
              loadError={topicsQuery.isError}
              actionError={topicMutations.error}
            />
          }
        >
          <Stack gap="compact" className="min-w-0 content-start">
            <Tabs
              value={statusTab}
              onValueChange={setStatusTab}
              ariaLabel="Prompt status"
              items={STATUS_TABS.map((tab) => ({
                value: tab.id,
                label: (
                  <>
                    {tab.label}
                    {statusCounts[tab.id] > 0 ? (
                      <span className="type-caption ml-2 tabular-nums">{statusCounts[tab.id]}</span>
                    ) : null}
                  </>
                ),
              }))}
            />

            {libraryBody}
          </Stack>
        </ResizableSplitPane>

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
            await importMutation.mutateAsync(rows).catch(() => undefined);
          }}
          isImporting={importMutation.isPending}
          importError={
            importMutation.isError ? humanizeApiError(importMutation.error).message : undefined
          }
          generateOpen={generateOpen}
          setGenerateOpen={setGenerateOpen}
          topics={topics}
          selectedTopicId={selectedTopicId}
          generatePrompts={async (input) => {
            await generateMutation.mutateAsync(input).catch(() => undefined);
          }}
          isGenerating={generateMutation.isPending}
          generateError={generateMutation.isError ? generateMutation.error : undefined}
          generateResult={generateResult}
          review={review}
          reviewOnly={reviewOnly}
          setsLoading={isLoading}
          setsError={error !== null}
          retrySets={retry}
        />
      </>
    </PageShell>
  );
}
