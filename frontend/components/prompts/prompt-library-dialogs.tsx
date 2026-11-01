import type { Dispatch, SetStateAction } from 'react';

import type { PromptGenerateInput, PromptImportRow } from '@/lib/api/prompts';
import type { Prompt, PromptGenerateResponse, Topic } from '@/lib/api/types';
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
  formError?: string;
  importOpen: boolean;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  importPrompts: (rows: PromptImportRow[]) => Promise<void>;
  isImporting: boolean;
  importError?: string;
  builderOpen: boolean;
  setBuilderOpen: (open: boolean) => void;
  builderStep: BuilderStep;
  hasCompetitors: boolean;
  topics: Topic[];
  selectedTopicId: string | null;
  generatePrompts: (input: PromptGenerateInput) => Promise<PromptGenerateResponse | null>;
  isGenerating: boolean;
  generateError?: unknown;
  onTopicsChanged: () => Promise<void>;
  review: ReturnType<typeof usePromptCandidates>;
  setsLoading?: boolean;
  setsError?: boolean;
  retrySets?: () => void;
  pendingDelete: PendingDelete | null;
  setPendingDelete: (pending: PendingDelete | null) => void;
  confirmDelete: (pending: PendingDelete) => void;
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
  onTopicsChanged,
  review,
  setsLoading,
  setsError,
  retrySets,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
}: Readonly<PromptLibraryDialogsProps>) {
  return (
    <>
      <ConfirmDeleteDialog
        pending={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) confirmDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
      <PromptFormDialog
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
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importPrompts}
        isImporting={isImporting}
        error={importError}
      />
      <PromptBuilder
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
        onTopicsChanged={onTopicsChanged}
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
