'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  factTopicSchema,
  type BrandFact,
  type BrandFactList,
  type FactTopic,
} from '@citeladder/contracts/fact-checking';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { panelClasses } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { TOPIC_LABELS } from '@/lib/visibility/accuracy';

const TOPIC_OPTIONS = factTopicSchema.options.map((topic) => ({
  value: topic,
  label: TOPIC_LABELS[topic],
}));

type Draft = { topic: FactTopic; statement: string; source_url: string };
type Change = { fact: BrandFact; update: Partial<Omit<BrandFact, 'id' | 'revision'>> };

const EMPTY_DRAFT: Draft = { topic: 'pricing', statement: '', source_url: '' };

/**
 * Brand facts for the fact-checking pilot: statements of record that answers
 * are checked against. Only confirmed facts are used, and a run checks the
 * facts confirmed when it started.
 */
export function BrandFactsPanel({
  workspaceId,
  projectId,
  list,
  mayEdit,
}: Readonly<{ workspaceId: string; projectId: string; list: BrandFactList; mayEdit: boolean }>) {
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.brandFacts(projectId) });
  const create = useMutation({
    mutationFn: (draft: Draft) =>
      projectsApi.createBrandFact(
        projectId,
        {
          topic: draft.topic,
          statement: draft.statement.trim(),
          source_url: draft.source_url.trim() || null,
        },
        { workspaceId },
      ),
    onSuccess: refresh,
  });
  const change = useMutation({
    mutationFn: ({ fact, update }: Change) =>
      projectsApi.updateBrandFact(
        projectId,
        fact.id,
        { expected_revision: fact.revision, ...update },
        { workspaceId },
      ),
    onSettled: refresh,
  });
  const active = list.facts.filter((fact) => fact.status !== 'retired');
  const retired = list.facts.filter((fact) => fact.status === 'retired');
  return (
    <Stack gap="workspace">
      {mayEdit ? (
        <AddFact pending={create.isPending} onAdd={(draft) => create.mutate(draft)} />
      ) : null}
      {create.isError ? (
        <MutationNotice notice={mutationNoticeForError(create.error, { action: 'add the fact' })} />
      ) : null}
      {change.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(change.error, { action: 'update the fact' })}
        />
      ) : null}
      {!active.length ? (
        <InlineEmpty>
          No facts yet. Add pricing, plans, integrations or other facts to check.
        </InlineEmpty>
      ) : (
        <ul className="grid gap-2">
          {active.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              mayEdit={mayEdit}
              pending={change.isPending}
              onChange={(update) => change.mutateAsync({ fact, update })}
            />
          ))}
        </ul>
      )}
      {retired.length ? (
        <p className={textRole('caption', 'text-muted')}>
          {retired.length} retired {retired.length === 1 ? 'fact is' : 'facts are'} kept for earlier
          runs and no longer checked.
        </p>
      ) : null}
    </Stack>
  );
}

function AddFact({
  pending,
  onAdd,
}: Readonly<{ pending: boolean; onAdd: (draft: Draft) => void }>) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  return (
    <form
      className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid gap-3')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.statement.trim()) return;
        onAdd(draft);
        setDraft(EMPTY_DRAFT);
      }}
    >
      <Field label="Topic">
        {(props) => (
          <Select
            {...props}
            ariaLabel="Topic"
            value={draft.topic}
            options={TOPIC_OPTIONS}
            onValueChange={(topic) => setDraft({ ...draft, topic })}
          />
        )}
      </Field>
      <Field label="Fact" hint="One statement, as you would want an answer to say it.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={300}
            value={draft.statement}
            placeholder="For example: The Pro plan costs $49 per month."
            onChange={(event) => setDraft({ ...draft, statement: event.target.value })}
          />
        )}
      </Field>
      <Field label="Source page (optional)">
        {(props) => (
          <Input
            {...props}
            type="url"
            value={draft.source_url}
            placeholder="https://"
            onChange={(event) => setDraft({ ...draft, source_url: event.target.value })}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={pending || !draft.statement.trim()}>
          Add draft fact
        </Button>
      </div>
    </form>
  );
}

function FactRow({
  fact,
  mayEdit,
  pending,
  onChange,
}: Readonly<{
  fact: BrandFact;
  mayEdit: boolean;
  pending: boolean;
  /** Settles with the save; the panel shows the error notice when it fails. */
  onChange: (update: Change['update']) => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <li className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid min-w-0 gap-2')}>
      <span className="flex flex-wrap items-center gap-2">
        <Badge>{TOPIC_LABELS[fact.topic]}</Badge>
        {fact.status === 'confirmed' ? (
          <Badge variant="status" value="success">
            Confirmed
          </Badge>
        ) : (
          <Badge variant="status" value="warning">
            Draft · not used until confirmed
          </Badge>
        )}
      </span>
      {editing === null ? (
        <span className={textRole('body')}>{fact.statement}</span>
      ) : (
        <Textarea
          aria-label="Edit fact"
          rows={2}
          maxLength={300}
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
        />
      )}
      {fact.source_url ? (
        <span className={textRole('caption', 'text-muted break-all')}>{fact.source_url}</span>
      ) : null}
      {mayEdit ? (
        <span className="flex flex-wrap gap-2">
          {editing === null ? (
            <>
              {fact.status === 'draft' ? (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void onChange({ status: 'confirmed' }).catch(() => undefined)}
                >
                  Confirm
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setEditing(fact.statement)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => void onChange({ status: 'retired' }).catch(() => undefined)}
              >
                Retire
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={pending || !editing.trim()}
                onClick={() => {
                  // Keep the draft open until the save lands, so a failed save loses nothing.
                  onChange({ statement: editing.trim() }).then(
                    () => setEditing(null),
                    () => undefined,
                  );
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </>
          )}
        </span>
      ) : null}
    </li>
  );
}
