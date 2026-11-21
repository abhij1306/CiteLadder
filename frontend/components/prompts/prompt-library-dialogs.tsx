import type { Dispatch, SetStateAction } from 'react';

import type { PromptImportRowRequest } from '@citeladder/contracts/prompt-requests';
import type { Prompt, PromptFormLimits, Topic } from '@citeladder/contracts';
import type { MutationNotice } from '@/lib/api/mutation-notice';
import type { PromptFormValues } from '@/lib/prompts/forms';
import { ConfirmDialog } from '@/components/ui/dialog';

import { deleteRequest, type PendingDelete } from './confirm-delete-dialog';
import { CsvImportDialog } from './csv-import-dialog';
import { PromptFormDialog } from './prompt-form-dialog';

type PromptLibraryDialogsProps = {
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
  topics: Topic[];
  selectedTopicId: string | null;
  pendingDelete: PendingDelete | null;
  setPendingDelete: (pending: PendingDelete | null) => void;
  confirmDelete: (pending: PendingDelete) => void;
  limits: PromptFormLimits | null;
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
  topics,
  selectedTopicId,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
  limits,
}: Readonly<PromptLibraryDialogsProps>) {
  const deleteDialog = (
    <ConfirmDialog
      request={deleteRequest(pendingDelete, () => {
        if (pendingDelete) confirmDelete(pendingDelete);
        setPendingDelete(null);
      })}
      onCancel={() => setPendingDelete(null)}
    />
  );
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
    </>
  );
}
