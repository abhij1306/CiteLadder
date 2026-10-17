'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Prompt, Topic } from '@/lib/api/types';
import {
  buyerStageLabels,
  buyerStageValues,
  emptyPromptForm,
  intentLabels,
  intentValues,
  promptFormSchema,
  promptToFormValues,
  type PromptFormValues,
} from '@/lib/prompts/forms';

const INTENT_OPTIONS = intentValues.map((value) => ({ value, label: intentLabels[value] }));
const STAGE_OPTIONS = buyerStageValues.map((value) => ({ value, label: buyerStageLabels[value] }));

/**
 * Add / edit prompt dialog. react-hook-form + zod; the same form serves
 * create (no `prompt`) and edit (prefilled from `prompt`). It asks for the
 * prompt and its topic, plus its intent, buyer stage and persona tags when editing,
 * and hands the validated values to `onSubmit`, whose
 * owner maps them to a create or an update payload.
 */
/** Saving wins over both; otherwise the verb follows which dialog this is. */
function submitLabel(saving: boolean | undefined, editing: boolean): string {
  if (saving) return 'Saving…';
  return editing ? 'Save changes' : 'Add prompt';
}

export function PromptFormDialog({
  open,
  onOpenChange,
  prompt,
  topics,
  defaultTopicId,
  onSubmit,
  isSaving,
  error,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: Prompt;
  topics: readonly Topic[];
  /** The topic a new prompt starts under: the one the reader is viewing. */
  defaultTopicId: string | null;
  onSubmit: (values: PromptFormValues) => Promise<void> | void;
  isSaving?: boolean;
  error?: string;
}>) {
  const isEdit = Boolean(prompt);
  // Stable across renders: `values` re-syncs the form whenever it changes.
  const initialValues = useMemo(
    () => (prompt ? promptToFormValues(prompt) : emptyPromptForm(defaultTopicId)),
    [prompt, defaultTopicId],
  );
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PromptFormValues>({
    resolver: zodResolver(promptFormSchema),
    values: initialValues,
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) reset(initialValues);
    onOpenChange(next);
  };

  const topicOptions = [
    { value: '', label: 'No topic' },
    ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={isEdit ? 'Edit prompt' : 'Add prompt'}
      footer={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={isSaving}>
            {submitLabel(isSaving, isEdit)}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="grid gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field label="Topic">
          {(props) => (
            <Controller
              control={control}
              name="topicId"
              render={({ field }) => (
                <Select
                  {...props}
                  ariaLabel="Topic"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={topicOptions}
                />
              )}
            />
          )}
        </Field>

        <Field label="Prompt" required error={errors.text?.message}>
          {(props) => (
            <Textarea
              {...props}
              {...register('text')}
              placeholder="What are the best running shoes for flat feet?"
            />
          )}
        </Field>

        {/* Tags are set on generation or import; editing corrects them. */}
        {isEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intent">
              {(props) => (
                <Controller
                  control={control}
                  name="intent"
                  render={({ field }) => (
                    <Select
                      {...props}
                      ariaLabel="Intent"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={INTENT_OPTIONS}
                    />
                  )}
                />
              )}
            </Field>
            <Field label="Buyer stage">
              {(props) => (
                <Controller
                  control={control}
                  name="buyerStage"
                  render={({ field }) => (
                    <Select
                      {...props}
                      ariaLabel="Buyer stage"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={STAGE_OPTIONS}
                    />
                  )}
                />
              )}
            </Field>
            {/* Tags are not part of a run's frozen prompt panel, so a
                correction keeps the prompt's comparison series. */}
            <Field label="Persona" error={errors.persona?.message} className="sm:col-span-2">
              {(props) => (
                <Input {...props} {...register('persona')} placeholder="Marathon runners" />
              )}
            </Field>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
