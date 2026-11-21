import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Tag } from '@/components/ui/tag';
import { ChevronDown, Plus, RotateCcw, Sparkles, Tags, Trash2 } from '@/lib/icons';
import { isImeComposing } from '@/lib/accessibility/ime';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { TopicRow } from '@/lib/prompts/builder-topics';

import { GenerateErrorAlert } from './generation-alerts';
import type { BuilderTopics } from './use-builder-topics';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const TOPIC_NAME_MAX = 255;

function rowTag(row: TopicRow): string | null {
  if (row.kind === 'proposed') return null;
  if (row.kind === 'existing' && row.removed) return 'Removing';
  if (row.kind === 'added') return 'New';
  return row.nested ? 'Subtopic' : 'Existing';
}

function TopicRowEditor({
  row,
  disabled,
  onChange,
  onRemove,
}: Readonly<{
  row: TopicRow;
  disabled: boolean;
  onChange: (row: TopicRow) => void;
  onRemove: () => void;
}>) {
  const removed = row.kind === 'existing' && row.removed;
  const tag = rowTag(row);
  return (
    <Inline as="li">
      <Input
        aria-label={`Topic name: ${row.name || 'unnamed'}`}
        value={row.name}
        maxLength={TOPIC_NAME_MAX}
        disabled={disabled || removed}
        onChange={(event) => onChange({ ...row, name: event.target.value })}
      />
      {tag ? <Tag>{tag}</Tag> : null}
      {removed ? (
        <IconButton
          icon={RotateCcw}
          label={`Keep ${row.savedName}`}
          disabled={disabled}
          onClick={() => onChange({ ...row, removed: false })}
        />
      ) : (
        <IconButton
          icon={Trash2}
          label={`Remove ${row.name || 'topic'}`}
          disabled={disabled}
          onClick={onRemove}
        />
      )}
    </Inline>
  );
}

export function BuilderTopicsStep({ topics }: Readonly<{ topics: BuilderTopics }>) {
  const [name, setName] = useState('');
  const busy = topics.preview.isPending || topics.confirm.isPending;
  const update = (key: string, next: TopicRow) =>
    topics.setRows(topics.rows.map((row) => (row.key === key ? next : row)));
  const remove = (row: TopicRow) =>
    topics.setRows(
      row.kind === 'existing'
        ? topics.rows.map((item) => (item.key === row.key ? { ...row, removed: true } : item))
        : topics.rows.filter((item) => item.key !== row.key),
    );
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    topics.setRows([...topics.rows, { kind: 'added', key: crypto.randomUUID(), name: trimmed }]);
    setName('');
  };
  return (
    <Stack gap="workspace" className="max-w-[var(--container-prose)]">
      <Inline className="flex-wrap justify-end">
        <Button
          variant="secondary"
          onClick={() => topics.preview.mutate()}
          disabled={busy}
          pending={topics.preview.isPending}
          pendingLabel="Suggesting…"
        >
          <Icon icon={Sparkles} />
          Suggest topics
        </Button>
      </Inline>
      {topics.preview.error ? (
        <GenerateErrorAlert error={topics.preview.error} action="propose topics" />
      ) : null}
      {topics.confirm.error ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(topics.confirm.error, { action: 'confirm the topics' })}
        />
      ) : null}
      {topics.problem ? <Notice tone="warning">{topics.problem}</Notice> : null}
      {topics.rows.length ? (
        <Stack as="ul" gap="item" aria-label="Topics">
          {topics.rows.map((row) => (
            <TopicRowEditor
              key={row.key}
              row={row}
              disabled={busy}
              onChange={(next) => update(row.key, next)}
              onRemove={() => remove(row)}
            />
          ))}
        </Stack>
      ) : (
        <StateBlock
          kind="empty"
          inline
          icon={Tags}
          message="No topics yet. Suggest topics from your offerings, or add one."
        />
      )}
      {topics.overflow.length ? (
        <Inline>
          <Button variant="quiet" onClick={topics.showOverflow} disabled={busy}>
            <Icon icon={ChevronDown} />+{topics.overflow.length} more
          </Button>
        </Inline>
      ) : null}
      <Inline>
        <Input
          aria-label="New topic name"
          placeholder="Add a topic"
          value={name}
          maxLength={TOPIC_NAME_MAX}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || isImeComposing(event)) return;
            event.preventDefault();
            add();
          }}
        />
        <Button variant="secondary" onClick={add} disabled={busy || !name.trim()}>
          <Icon icon={Plus} />
          Add
        </Button>
      </Inline>
    </Stack>
  );
}
