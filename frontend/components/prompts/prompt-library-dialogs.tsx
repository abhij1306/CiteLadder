import type { Dispatch, SetStateAction } from 'react';

import type { PromptGenerateInput, PromptImportRow } from '@/lib/api/prompts';
import type { Prompt, PromptGenerateResponse, Topic } from '@/lib/api/types';
import type { PromptFormValues } from '@/lib/prompts/forms';
import type { usePromptCandidates } from '@/lib/prompts/use-prompt-candidates';

import { CandidateReviewPanel } from './candidate-review';
import { ConfirmDeleteDialog, type PendingDelete } from './confirm-delete-dialog';
import { CsvImportDialog } from './csv-import-dialog';
import { GeneratePromptsDialog } from './generate-prompts-dialog';
import { PromptFormDialog } from './prompt-form-dialog';

type PromptLibraryDialogsProps = {
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
  generateOpen: boolean;
  setGenerateOpen: Dispatch<SetStateAction<boolean>>;
  topics: Topic[];
  selectedTopicId: string | null;
  generatePrompts: (input: PromptGenerateInput) => Promise<void>;
  isGenerating: boolean;
  generateError?: unknown;
  generateResult: PromptGenerateResponse | null;
  review: ReturnType<typeof usePromptCandidates>;
  reviewOnly?: boolean;
  setsLoading?: boolean;
  setsError?: boolean;
  retrySets?: () => void;
  pendingDelete: PendingDelete | null;
  setPendingDelete: (pending: PendingDelete | null) => void;
  confirmDelete: (pending: PendingDelete) => void;
};

export function PromptLibraryDialogs({
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
  generateOpen,
  setGenerateOpen,
  topics,
  selectedTopicId,
  generatePrompts,
  isGenerating,
  generateError,
  generateResult,
  review,
  reviewOnly,
  setsLoading,
  setsError,
  retrySets,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
}: Readonly<PromptLibraryDialogsProps>) {
  const reviewing =
    reviewOnly ||
    setsLoading ||
    setsError ||
    review.isLoading ||
    Boolean(review.loadError) ||
    review.candidates.length > 0 ||
    Boolean(review.notice);
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
      <GeneratePromptsDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        topics={topics}
        defaultTopicId={selectedTopicId}
        onGenerate={generatePrompts}
        isGenerating={isGenerating}
        error={generateError}
        result={generateResult}
        review={
          reviewing ? (
            <CandidateReviewPanel
              review={review}
              topics={topics}
              setsLoading={setsLoading}
              setsError={setsError}
              retrySets={retrySets}
            />
          ) : null
        }
      />
    </>
  );
}
