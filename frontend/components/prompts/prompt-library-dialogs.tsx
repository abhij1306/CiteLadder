import type { Dispatch, SetStateAction } from 'react';

import type {
  PromptGenerateRequest,
  PromptImportRowRequest,
} from '@citeladder/contracts/prompt-requests';
import type {
  Prompt,
  PromptFormLimits,
  PromptGenerateResponse,
  Topic,
} from '@citeladder/contracts';
import type { MutationNotice } from '@/lib/api/mutation-notice';
import type { PromptFormValues } from '@/lib/prompts/forms';
import type { usePromptCandidates } from '@/lib/prompts/use-prompt-candidates';

import { CandidateReviewPanel } from './candidate-review';
import { ConfirmDeleteDialog, type PendingDelete } from './confirm-delete-dialog';
import { CsvImportDialog } from './csv-import-dialog';
import { PromptBuilder, type BuilderStep } from './prompt-builder';
import { PromptFormDialog } from './prompt-form-dialog';

type PromptLibraryDialogsProps = {
  projectId: string;
  workspaceId: string;
  formOpen: boolean;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  editing: Prompt | undefined;
  setEditing: Dispatch<SetStateAction<Prompt | undefined>>;
  submitForm: (values: PromptFormValues) => Promise<void>;
  isSaving: boolean;
  formError?: MutationNotice;
  importOpen: boolean;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  importPrompts: (rows: PromptImportRowRequest[]) => Promise<void>;
  isImporting: boolean;
  importError?: MutationNotice;
  builderOpen: boolean;
  setBuilderOpen: (open: boolean) => void;
  builderStep: BuilderStep;
  hasCompetitors: boolean;
  topics: Topic[];
  selectedTopicId: string | null;
  generatePrompts: (input: PromptGenerateRequest) => Promise<PromptGenerateResponse | null>;
  isGenerating: boolean;
  generateError?: unknown;
  review: ReturnType<typeof usePromptCandidates>;
  setsLoading?: boolean;
  setsError?: boolean;
  retrySets?: () => void;
  pendingDelete: PendingDelete | null;
  setPendingDelete: (pending: PendingDelete | null) => void;
  confirmDelete: (pending: PendingDelete) => void;
  /** The forms' server-enforced bounds; null until the prompt-set list loads. */
  limits: PromptFormLimits | null;
};

export function PromptLibraryDialogs({
  projectId,
  workspaceId,
  formOpen,
  setFormOpen,
  editing,
  setEditing,
  submitForm,
  isSaving,
  formError,
  importOpen,
  setImportOpen,
  importPrompts,
  isImporting,
  importError,
  builderOpen,
  setBuilderOpen,
  builderStep,
  hasCompetitors,
  topics,
  selectedTopicId,
  generatePrompts,
  isGenerating,
  generateError,
  review,
  setsLoading,
  setsError,
  retrySets,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
  limits,
}: Readonly<PromptLibraryDialogsProps>) {
  const deleteDialog = (
    <ConfirmDeleteDialog
      pending={pendingDelete}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => {
        if (pendingDelete) confirmDelete(pendingDelete);
        setPendingDelete(null);
      }}
    />
  );
  // The forms enforce the server's bounds, so they open once the list has listed them.
  if (!limits) return deleteDialog;
  return (
    <>
      {deleteDialog}
      <PromptFormDialog
        limits={limits}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        prompt={editing}
        topics={topics}
        defaultTopicId={selectedTopicId}
        onSubmit={submitForm}
        isSaving={isSaving}
        error={formError}
      />
      <CsvImportDialog
        limits={limits}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importPrompts}
        isImporting={isImporting}
        error={importError}
      />
      <PromptBuilder
        limits={limits}
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        initialStep={builderStep}
        projectId={projectId}
        workspaceId={workspaceId}
        topics={topics}
        hasCompetitors={hasCompetitors}
        generate={generatePrompts}
        isGenerating={isGenerating}
        generateError={generateError}
        review={
          <CandidateReviewPanel
            review={review}
            topics={topics}
            setsLoading={setsLoading}
            setsError={setsError}
            retrySets={retrySets}
          />
        }
      />
    </>
  );
}
