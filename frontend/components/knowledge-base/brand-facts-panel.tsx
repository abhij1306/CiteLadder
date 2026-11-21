import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import {
  factTopicSchema,
  type BrandFact,
  type BrandFactList,
  type FactTopic,
} from '@citeladder/contracts/fact-checking';

import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline } from '@/components/ui/layout';
import { SettingField, SettingRow, SettingRows } from '@/components/ui/setting-row';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { Archive, Check, Pencil, Plus, Save, X } from '@/lib/icons';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { formatCount } from '@/lib/format';
import { projectMutations } from '@/lib/api/projects';
import { TOPIC_LABELS } from '@/lib/visibility/accuracy';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const TOPIC_OPTIONS = factTopicSchema.options.map((topic) => ({
  value: topic,
  label: TOPIC_LABELS[topic],
}));

type Draft = { topic: FactTopic; statement: string; source_url: string };
type Change = { fact: BrandFact; update: Partial<Omit<BrandFact, 'id' | 'revision'>> };

const EMPTY_DRAFT: Draft = { topic: 'pricing', statement: '', source_url: '' };

export function BrandFactsPanel({
  workspaceId,
  projectId,
  list,
  mayEdit,
}: Readonly<{ workspaceId: string; projectId: string; list: BrandFactList; mayEdit: boolean }>) {
  const scope = { workspaceId, projectId };
  const create = useMutation(projectMutations.createBrandFact(scope));
  const change = useMutation(projectMutations.updateBrandFact(scope));
  const addFact = (draft: Draft) =>
    create.mutateAsync({
      topic: draft.topic,
      statement: draft.statement.trim(),
      source_url: draft.source_url.trim() || null,
    });
  const changeFact = ({ fact, update }: Change) =>
    change.mutateAsync({
      factId: fact.id,
      input: { expected_revision: fact.revision, ...update },
    });
  const active = list.facts.filter((fact) => fact.status !== 'retired');
  const retired = list.facts.filter((fact) => fact.status === 'retired');
  return (
    <>
      {create.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(create.error, { action: 'add the fact' })}
        />
      ) : null}
      {change.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(change.error, { action: 'update the fact' })}
        />
      ) : null}
      {!active.length ? (
        <StateBlock
          kind="empty"
          inline
          message="No facts yet. Add pricing, plans, integrations or other facts to check."
        />
      ) : (
        <SettingRows label="Brand facts">
          {active.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              mayEdit={mayEdit}
              maxChars={list.limits.statement_max_chars}
              pending={change.isPending}
              onChange={(update) => changeFact({ fact, update })}
            />
          ))}
        </SettingRows>
      )}
      {retired.length ? (
        <p className={textRole('caption')}>Retired facts: {formatCount(retired.length)}</p>
      ) : null}
      {mayEdit ? (
        <AddFact
          maxChars={list.limits.statement_max_chars}
          pending={create.isPending}
          onAdd={addFact}
        />
      ) : null}
    </>
  );
}

function AddFact({
  maxChars,
  pending,
  onAdd,
}: Readonly<{ maxChars: number; pending: boolean; onAdd: (draft: Draft) => Promise<unknown> }>) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const submit = async () => {
    const sent = draft;
    try {
      await onAdd(sent);
    } catch {
      return;
    }
    setDraft((current) => (current === sent ? EMPTY_DRAFT : current));
  };
  const empty = !draft.statement.trim();
  return (
    <form
      aria-label="Add a fact"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || empty) return;
        void submit();
      }}
    >
      <SettingRows
        foot={
          <Button type="submit" variant="primary" disabled={pending || empty}>
            <Icon icon={Plus} />
            Add draft fact
          </Button>
        }
      >
        <SettingField inline label="Topic">
          {(props) => (
            <Select
              id={props.id}
              ariaLabel="Topic"
              value={draft.topic}
              options={TOPIC_OPTIONS}
              onValueChange={(topic) => setDraft({ ...draft, topic })}
            />
          )}
        </SettingField>
        <SettingField label="Fact">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={maxChars}
              value={draft.statement}
              onChange={(event) => setDraft({ ...draft, statement: event.target.value })}
            />
          )}
        </SettingField>
        <SettingField label="Source page (optional)" hint="Starts with https://">
          {(props) => (
            <Input
              {...props}
              type="url"
              value={draft.source_url}
              onChange={(event) => setDraft({ ...draft, source_url: event.target.value })}
            />
          )}
        </SettingField>
      </SettingRows>
    </form>
  );
}

function FactRow({
  fact,
  mayEdit,
  maxChars,
  pending,
  onChange,
}: Readonly<{
  fact: BrandFact;
  mayEdit: boolean;
  maxChars: number;
  pending: boolean;
  onChange: (update: Change['update']) => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <SettingRow
      label={
        editing === null ? (
          <span className={textRole('body')}>{fact.statement}</span>
        ) : (
          <Textarea
            aria-label="Edit fact"
            rows={2}
            maxLength={maxChars}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
        )
      }
      description={
        <Inline as="span" gap="status">
          <Tag>{TOPIC_LABELS[fact.topic]}</Tag>
          {fact.status === 'confirmed' ? (
            <StatusMark variant="status" value="success">
              Confirmed
            </StatusMark>
          ) : (
            <StatusMark variant="status" value="warning">
              Draft
            </StatusMark>
          )}
          {fact.source_url ? (
            <span className={textRole('caption', 'min-w-0 truncate')}>{fact.source_url}</span>
          ) : null}
        </Inline>
      }
      action={
        mayEdit ? (
          <FactActions
            fact={fact}
            editing={editing}
            pending={pending}
            onEdit={setEditing}
            onChange={onChange}
          />
        ) : undefined
      }
    />
  );
}

function FactActions({
  fact,
  editing,
  pending,
  onEdit,
  onChange,
}: Readonly<{
  fact: BrandFact;
  editing: string | null;
  pending: boolean;
  onEdit: (draft: string | null) => void;
  onChange: (update: Change['update']) => Promise<unknown>;
}>) {
  if (editing === null)
    return (
      <Inline as="span" className="flex-wrap">
        {fact.status === 'draft' ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => void onChange({ status: 'confirmed' }).catch(() => undefined)}
          >
            <Icon icon={Check} />
            Confirm
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => onEdit(fact.statement)}>
          <Icon icon={Pencil} />
          Edit
        </Button>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() => void onChange({ status: 'retired' }).catch(() => undefined)}
        >
          <Icon icon={Archive} />
          Retire
        </Button>
      </Inline>
    );
  return (
    <Inline as="span" className="flex-wrap">
      <Button variant="quiet" onClick={() => onEdit(null)}>
        <Icon icon={X} />
        Cancel
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !editing.trim()}
        onClick={() => {
          onChange({ statement: editing.trim() }).then(
            () => onEdit(null),
            () => undefined,
          );
        }}
      >
        <Icon icon={Save} />
        Save
      </Button>
    </Inline>
  );
}
