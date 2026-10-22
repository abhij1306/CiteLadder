'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { listRowClasses } from '@/components/ui/list-row';
import { Select } from '@/components/ui/select';
import { Pressable } from '@/components/ui/pressable';
import { Tooltip } from '@/components/ui/tooltip';
import type { Topic } from '@/lib/api/types';
import { orderTopicsForRail } from '@/lib/prompts/topic-tree';
import { cn } from '@/lib/utils';
import { textRole } from '@/components/ui/typography';

const TOPICS_LOAD_ERROR = "Couldn't load topics. Check your connection and try again.";

/** Resolve the topic error copy: load failures outrank action failures. */
function topicErrorMessage(loadError?: boolean, actionError?: string | null): string | null {
  if (loadError) return TOPICS_LOAD_ERROR;
  return actionError ?? null;
}

/**
 * Topics selection (prompt library). Two responsive variants sharing one
 * selection model:
 *  - Desktop: a contained `bg-panel` rail listing the
 *    project's topics with per-status counts, an "All topics" bucket, an inline
 *    add-topic form (optionally under a top-level topic, one level deep), and
 *    per-topic inline rename and delete.
 *  - Narrow (below desktop): a compact full-width Topics picker stacked above the
 *    status tabs — the desktop rail would crush the table, so the rail
 *    collapses to a selector, preserving the IA with no overlap.
 * Selection filters the prompt table; deleting a topic detaches its prompts
 * (backend `SET NULL`) — it never deletes them. Presentational — mutations
 * live in the library container.
 */
export function TopicRail({
  topics,
  selectedTopicId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  isCreating,
  loadError,
  actionError,
}: Readonly<{
  topics: Topic[];
  /** null = "All topics". */
  selectedTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  /**
   * Create a topic, or a subtopic when `parentId` is set. Returning a promise
   * lets the rail keep the add form open (with the typed name intact) when
   * creation fails.
   */
  onCreate: (name: string, parentId: string | null) => Promise<void> | void;
  onDelete: (topic: Topic) => void;
  /** Rename a topic. A rejected promise keeps the edit open with the typed name. */
  onRename?: (topic: Topic, name: string) => Promise<void>;
  isCreating?: boolean;
  /** Set when the topics list failed to load. */
  loadError?: boolean;
  /** Rendered when a create/delete mutation fails. */
  actionError?: string | null;
}>) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  // Subtopics nest one level deep, so only top-level topics can be parents.
  const parents = topics.filter((topic) => !topic.parent_id);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onCreate(trimmed, parentId || null);
      // Only reset on success — a failed create keeps the form open with the
      // typed name so the user can retry without re-typing.
      setName('');
      setParentId('');
      setAdding(false);
    } catch {
      // Error surfaced via `actionError`; leave the form populated.
    }
  };

  const errorBanner = topicErrorMessage(loadError, actionError) ? (
    <Alert tone="danger">{topicErrorMessage(loadError, actionError)}</Alert>
  ) : null;

  return (
    <>
      {/* Desktop rail: raised surface that clips its own content
          so nothing from the right pane can overlap it. */}
      <Card className="desktop:block hidden min-w-0">
        <Stack as="nav" gap="tight" aria-label="Topics" className="min-w-0 content-start">
          <div className="flex items-center justify-between">
            <h3 className={textRole('label')}>Topics</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Add topic"
              onClick={() => setAdding((v) => !v)}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>

          {errorBanner}

          {adding ? (
            <Stack
              as="form"
              gap="compact"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="flex items-center gap-2">
                <Input
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- Add topic explicitly opens this form; focus follows the invoking action.
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Topic name"
                  aria-label="Topic name"
                />
                <Button type="submit" variant="secondary" disabled={isCreating || !name.trim()}>
                  Add
                </Button>
              </div>
              {parents.length ? (
                <Select
                  value={parentId}
                  onValueChange={setParentId}
                  ariaLabel="Add under"
                  className="w-full"
                  options={[
                    { value: '', label: 'Top-level topic' },
                    ...parents.map((topic) => ({
                      value: topic.id,
                      label: `Subtopic of ${topic.name}`,
                    })),
                  ]}
                />
              ) : null}
            </Stack>
          ) : null}

          <TopicItem
            label="All topics"
            selected={selectedTopicId === null}
            onSelect={() => onSelect(null)}
          />
          {orderTopicsForRail(topics).map(({ topic, nested, label }) => (
            <TopicItem
              key={topic.id}
              label={topic.name}
              accessibleName={nested ? label : undefined}
              nested={nested}
              activeCount={topic.active_count}
              selected={selectedTopicId === topic.id}
              onSelect={() => onSelect(topic.id)}
              onDelete={() => onDelete(topic)}
              onRename={onRename ? (next) => onRename(topic, next) : undefined}
            />
          ))}
        </Stack>
      </Card>

      {/* Narrow selector: full-width Topics picker shown below the lg
          breakpoint, stacked above the status tabs. */}
      <TopicSelect
        topics={topics}
        selectedTopicId={selectedTopicId}
        onSelect={onSelect}
        loadError={loadError}
        actionError={actionError}
      />
    </>
  );
}

/** Compact full-width Topics selector for narrow viewports (< lg). */
function TopicSelect({
  topics,
  selectedTopicId,
  onSelect,
  loadError,
  actionError,
}: Readonly<{
  topics: Topic[];
  selectedTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  loadError?: boolean;
  actionError?: string | null;
}>) {
  const labelId = useId();
  return (
    <Stack gap="compact" className="desktop:hidden">
      <span id={labelId} className={textRole('label')}>
        Topics
      </span>
      <Select
        ariaLabel="Topics"
        aria-labelledby={labelId}
        value={selectedTopicId ?? ''}
        onValueChange={(value) => onSelect(value === '' ? null : value)}
        className="w-full"
        options={[
          { value: '', label: 'All topics' },
          ...orderTopicsForRail(topics).map(({ topic, label }) => ({
            value: topic.id,
            label,
          })),
        ]}
      />
      {topicErrorMessage(loadError, actionError) ? (
        <Alert tone="danger">{topicErrorMessage(loadError, actionError)}</Alert>
      ) : null}
    </Stack>
  );
}

function TopicItem({
  label,
  accessibleName,
  nested = false,
  activeCount,
  selected,
  onSelect,
  onDelete,
  onRename,
}: Readonly<{
  label: string;
  /** Parent-qualified name for a subtopic; top-level items use their text. */
  accessibleName?: string;
  nested?: boolean;
  activeCount?: number;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => Promise<void>;
}>) {
  const [renaming, setRenaming] = useState(false);
  const name = accessibleName ?? label;
  if (renaming && onRename)
    return (
      <TopicRenameForm
        current={label}
        name={name}
        nested={nested}
        onRename={onRename}
        onDone={() => setRenaming(false)}
      />
    );
  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-0.5 pe-0.5',
        nested && 'ms-3',
        listRowClasses({ selected }),
      )}
    >
      <Pressable
        type="button"
        onClick={onSelect}
        aria-label={accessibleName}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] h-[var(--nav-item-height)] px-3 text-left type-control',
          selected && textRole('emphasis'),
        )}
      >
        <Tooltip content={label}>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Tooltip>
        {typeof activeCount === 'number' ? (
          <span className="type-caption shrink-0 tabular-nums">{activeCount}</span>
        ) : null}
      </Pressable>
      {onRename ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Rename topic ${name}`}
          onClick={() => setRenaming(true)}
          className="shrink-0"
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          type="button"
          variant="destructiveGhost"
          size="icon"
          aria-label={`Delete topic ${name}`}
          onClick={onDelete}
          className="shrink-0"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A topic's name, edited in place. Enter saves and Escape cancels; a failed
 * save keeps the typed name so the user can retry, and an unchanged or empty
 * name saves nothing.
 */
function TopicRenameForm({
  current,
  name,
  nested,
  onRename,
  onDone,
}: Readonly<{
  current: string;
  name: string;
  nested: boolean;
  onRename: (name: string) => Promise<void>;
  onDone: () => void;
}>) {
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === current) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      onDone();
    } catch {
      // Error surfaced via `actionError`; keep the typed name.
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className={cn('flex items-center gap-2', nested && 'ms-3')}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename explicitly opens this field; focus follows the invoking action.
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
        aria-label={`New name for ${name}`}
      />
      <Button type="submit" variant="secondary" disabled={saving || !draft.trim()}>
        Save
      </Button>
    </form>
  );
}
