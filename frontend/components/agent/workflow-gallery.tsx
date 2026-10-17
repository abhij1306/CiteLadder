'use client';

import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { panelClasses } from '@/components/ui/panel';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { missingInputs, workflowMessage, type WorkflowValues } from '@/lib/agent/workflows';
import type { AgentWorkflow } from '@/lib/api/agent';

/**
 * The defined jobs the Agent does, grouped as the reader thinks of them. A
 * card opens its short form; free-form questions stay in the composer above.
 */
export function WorkflowGallery({
  onPick,
  disabled,
}: Readonly<{ onPick: (workflow: AgentWorkflow) => void; disabled: boolean }>) {
  const catalog = useAgentCatalog();
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  const group = chosenGroup ?? catalog.workflow_groups[0]?.id;
  if (catalog.workflows.length === 0) return null;
  return (
    <section aria-labelledby="agent-workflows" className="grid gap-3">
      <h3 id="agent-workflows" className={textRole('label')}>
        Or start from a workflow
      </h3>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Workflow type</legend>
        {catalog.workflow_groups.map((option) => (
          <FilterChip
            key={option.id}
            active={option.id === group}
            onClick={() => setChosenGroup(option.id)}
          >
            {option.label}
          </FilterChip>
        ))}
      </fieldset>
      {/* Every group's cards share one grid cell, so the gallery is always as
          tall as its largest group: choosing a group never moves the page
          (which centres this column). Only the chosen group is live. */}
      <div className="grid">
        {catalog.workflow_groups.map((option) => {
          const live = option.id === group;
          return (
            <ul
              key={option.id}
              inert={!live}
              aria-hidden={!live || undefined}
              className={cn(
                'col-start-1 row-start-1 grid content-start gap-2 sm:grid-cols-2',
                !live && 'invisible',
              )}
            >
              {catalog.workflows
                .filter((workflow) => workflow.group === option.id)
                .map((workflow) => (
                  <li key={workflow.id} className="flex">
                    <Pressable
                      disabled={disabled}
                      onClick={() => onPick(workflow)}
                      className={panelClasses({ pad: 'compact' }, 'hover:bg-hover grid gap-1')}
                    >
                      <span className={textRole('itemTitle')}>{workflow.label}</span>
                      <span className={textRole('caption')}>{workflow.description}</span>
                    </Pressable>
                  </li>
                ))}
            </ul>
          );
        })}
      </div>
    </section>
  );
}

/** One workflow's inputs; starting it sends the composed first message. */
export function WorkflowStart({
  workflow,
  onStart,
  onBack,
  pending,
  disabled,
}: Readonly<{
  workflow: AgentWorkflow;
  onStart: (message: string) => void;
  onBack: () => void;
  pending: boolean;
  disabled: boolean;
}>) {
  const [values, setValues] = useState<WorkflowValues>({});
  const [attempted, setAttempted] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  // Opening a workflow moves focus to what the reader fills in next.
  useEffect(() => first.current?.focus(), []);
  const missing = missingInputs(workflow, values);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (missing.length === 0) onStart(workflowMessage(workflow, values));
  };
  return (
    <form
      aria-labelledby="workflow-title"
      // One inline message per missing input instead of the browser's bubble.
      noValidate
      onSubmit={submit}
      className={panelClasses({}, 'grid gap-4')}
    >
      <div className="grid gap-1">
        <h3 id="workflow-title" className={textRole('itemTitle')}>
          {workflow.label}
        </h3>
        <p className={textRole('caption')}>{workflow.description}</p>
      </div>
      {workflow.inputs.map((input, index) => (
        <Field
          key={input.key}
          label={input.label}
          required={input.required}
          error={attempted && missing.includes(input.key) ? 'Add this to start.' : undefined}
        >
          {(field) => (
            <Input
              {...field}
              ref={index === 0 ? first : undefined}
              value={values[input.key] ?? ''}
              disabled={disabled || pending}
              onChange={(event) =>
                setValues((current) => ({ ...current, [input.key]: event.target.value }))
              }
            />
          )}
        </Field>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4" />
          All workflows
        </Button>
        <Button type="submit" disabled={disabled || pending}>
          {pending ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </form>
  );
}
