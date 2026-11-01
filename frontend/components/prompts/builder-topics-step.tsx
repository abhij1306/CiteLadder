'use client';

import { Plus, RotateCcw, Sparkles, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { Tag } from '@/components/ui/tag';
import { textRole } from '@/components/ui/typography';
import { humanizeApiError } from '@/lib/api/errors';
import type { TopicRow } from '@/lib/prompts/builder-topics';

import { GenerateErrorAlert } from './generation-alerts';
import type { BuilderTopics } from './use-builder-topics';

const TOPIC_NAME_MAX = 255;

function rowTag(row: TopicRow): string {
  if (row.kind === 'proposed') return 'Proposed';
  if (row.kind === 'added') return 'New';
  return row.nested ? 'Subtopic' : 'Existing';
}

/** One topic: its editable name, where it came from, and remove (or keep, once removed). */
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
  return (
    <Stack as="li" gap="tight">
      <Inline>
        <Input
          aria-label={`Topic name: ${row.name || 'unnamed'}`}
          value={row.name}
          maxLength={TOPIC_NAME_MAX}
          disabled={disabled || removed}
          onChange={(event) => onChange({ ...row, name: event.target.value })}
        />
        <Tag>{removed ? 'Removing' : rowTag(row)}</Tag>
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
      {/* A proposal's offering links are saved on confirm; say which, so nothing is hidden. */}
      {row.kind === 'proposed' && row.offerings.length ? (
        <span className="type-caption">Covers {row.offerings.join('; ')}</span>
      ) : null}
    </Stack>
  );
}

/**
 * Step 2: the project's topics beside buyer-facing proposals. Proposals fill
 * gaps and never replace a topic; renames, removals and additions stay local
 * until the plan is confirmed.
 */
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
    <Stack gap="workspace">
      <Inline className="flex-wrap justify-between">
        <p className={textRole('body', 'text-secondary')}>
          Proposals fill gaps beside your topics and never replace them. A removed topic&apos;s
          prompts stay in your library without a topic. Nothing changes until you confirm.
        </p>
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
        <GenerateErrorAlert
          error={topics.preview.error}
          fallback="Topics could not be proposed. Try again."
        />
      ) : null}
      {topics.confirm.error ? (
        <Alert tone="danger">{humanizeApiError(topics.confirm.error).message}</Alert>
      ) : null}
      {topics.problem ? <Alert tone="warning">{topics.problem}</Alert> : null}
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
        <QueryState
          kind="empty"
          inline
          icon={Tags}
          message="No topics yet. Suggest topics from your offerings, or add one."
        />
      )}
      {topics.overflow.length ? (
        <Inline>
          <Button variant="ghost" onClick={topics.showOverflow} disabled={busy}>
            +{topics.overflow.length} more
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
            if (event.key !== 'Enter') return;
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
