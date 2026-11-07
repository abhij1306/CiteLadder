'use client';

import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FilterTrigger } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { TreeItem, TreeItemForm, TreeList } from '@/components/ui/list-row';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { QueryState } from '@/components/ui/query-state';
import { Select } from '@/components/ui/select';
import { ControlCount } from '@/components/ui/tabs';
import type { Topic } from '@citeladder/contracts';
import { orderTopicsForRail } from '@/lib/prompts/topic-tree';

import type { useTopicMutations } from './use-topic-mutations';

type TopicMutations = ReturnType<typeof useTopicMutations>;

const TOPICS_LOAD_ERROR = "Couldn't load topics. Check your connection and try again.";

/** The filter value for "All topics". */
const ALL_TOPICS = '';

/**
 * The Topic filter in the prompt library's control strip (owner, 2026-11-06:
 * it replaced the topics side panel so the table keeps the page's width).
 * "All topics", then every topic with its active-prompt count, a subtopic
 * named with its parent; the menu ends with "Add topic" and "Manage
 * topics…", which open the dialogs below. Selection filters the table.
 */
export function TopicFilter({
  topics,
  selectedTopicId,
  onSelect,
  onAdd,
  onManage,
}: Readonly<{
  topics: readonly Topic[];
  /** null = "All topics". */
  selectedTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  onAdd: () => void;
  onManage: () => void;
}>) {
  const ordered = orderTopicsForRail(topics);
  const selected = ordered.find(({ topic }) => topic.id === selectedTopicId);
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label="Topic"
          hideLabel
          value={selected?.label ?? 'All topics'}
          active={selectedTopicId !== null}
        />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Topic</MenuLabel>
        <MenuRadioGroup value={selectedTopicId ?? ALL_TOPICS}>
          <MenuRadioItem value={ALL_TOPICS} onSelect={() => onSelect(null)}>
            All topics
          </MenuRadioItem>
          {ordered.map(({ topic, label }) => (
            <MenuRadioItem key={topic.id} value={topic.id} onSelect={() => onSelect(topic.id)}>
              {label}
              <ControlCount count={topic.active_count} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<Icon icon={Plus} />} onSelect={onAdd}>
          Add topic
        </MenuItem>
        <MenuItem icon={<Icon icon={Settings2} />} onSelect={onManage}>
          Manage topics…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * Adds a topic, or a subtopic under a top-level topic (subtopics nest one
 * level deep). A failed create keeps the dialog open with the typed name so
 * the person can retry; a successful one closes it.
 */
export function AddTopicDialog({
  open,
  onOpenChange,
  topics,
  onCreate,
  isCreating = false,
  error,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: readonly Topic[];
  /** Rejects when the create fails; the error is then shown from `error`. */
  onCreate: (name: string, parentId: string | null) => Promise<void>;
  isCreating?: boolean;
  error?: MutationNoticeData | null;
}>) {
  const formId = useId();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const parents = topics.filter((topic) => !topic.parent_id);

  const close = (next: boolean) => {
    if (!next) {
      setName('');
      setParentId('');
    }
    onOpenChange(next);
  };
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onCreate(trimmed, parentId || null);
      close(false);
    } catch {
      // Shown through `error`; the typed name stays for a retry.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add topic"
      description="Topics group prompts so you can filter and compare them."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isCreating || !name.trim()}>
            Add topic
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <MutationNotice notice={error} /> : null}
        <Field label="Topic name" required>
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Running shoes"
            />
          )}
        </Field>
        {parents.length ? (
          <Field label="Add under">
            {(props) => (
              <Select
                id={props.id}
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
            )}
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}

export type TopicDialog = 'add' | 'manage';

/**
 * The library's topic-load notice and its two topic dialogs over one set of
 * topic writes. A create
 * failure shows in Add topic; rename and delete failures show in Manage topics.
 */
export function TopicDialogs({
  dialog,
  onDialogChange,
  topics,
  mutations,
  loadError,
  onAdd,
  onDelete,
}: Readonly<{
  dialog: TopicDialog | null;
  onDialogChange: (dialog: TopicDialog | null) => void;
  topics: readonly Topic[];
  mutations: TopicMutations;
  loadError: boolean;
  onAdd: () => void;
  onDelete: (topic: Topic) => void;
}>) {
  const createFailed = mutations.create.isError;
  return (
    <>
      {loadError ? <Callout tone="negative">{TOPICS_LOAD_ERROR}</Callout> : null}
      <AddTopicDialog
        open={dialog === 'add'}
        onOpenChange={(open) => onDialogChange(open ? 'add' : null)}
        topics={topics}
        onCreate={async (name, parentId) => {
          await mutations.create.mutateAsync({ name, parent_id: parentId });
        }}
        isCreating={mutations.create.isPending}
        error={createFailed ? mutations.error : null}
      />
      <ManageTopicsDialog
        open={dialog === 'manage'}
        onOpenChange={(open) => onDialogChange(open ? 'manage' : null)}
        topics={topics}
        onRename={async (topic, name) => {
          await mutations.rename.mutateAsync({ topic, name });
        }}
        onDelete={onDelete}
        onAdd={onAdd}
        loadError={loadError}
        actionError={createFailed ? null : mutations.error}
      />
    </>
  );
}

/**
 * Every topic with its active-prompt count and its rename and delete
 * actions. Deleting asks first (the library's confirmation) and detaches the
 * topic's prompts — it never deletes them.
 */
export function ManageTopicsDialog({
  open,
  onOpenChange,
  topics,
  onRename,
  onDelete,
  onAdd,
  loadError = false,
  actionError,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: readonly Topic[];
  /** Rejects when the rename fails; the typed name then stays for a retry. */
  onRename: (topic: Topic, name: string) => Promise<void>;
  onDelete: (topic: Topic) => void;
  onAdd: () => void;
  loadError?: boolean;
  actionError?: MutationNoticeData | null;
}>) {
  const ordered = orderTopicsForRail(topics);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage topics"
      footer={
        <>
          <Button variant="secondary" onClick={onAdd}>
            <Icon icon={Plus} />
            Add topic
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </>
      }
    >
      {loadError ? <Callout tone="negative">{TOPICS_LOAD_ERROR}</Callout> : null}
      {!loadError && actionError ? <MutationNotice notice={actionError} /> : null}
      {ordered.length ? (
        <TreeList label="Topics">
          {ordered.map(({ topic, nested, label }) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              name={label}
              nested={nested}
              onRename={(next) => onRename(topic, next)}
              onDelete={() => onDelete(topic)}
            />
          ))}
        </TreeList>
      ) : (
        <QueryState kind="empty" inline message="No topics yet." />
      )}
    </Dialog>
  );
}

function TopicRow({
  topic,
  name,
  nested,
  onRename,
  onDelete,
}: Readonly<{
  topic: Topic;
  /** Parent-qualified for a subtopic, so same-named subtopics stay distinct. */
  name: string;
  nested: boolean;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}>) {
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <TopicRenameForm
        current={topic.name}
        name={name}
        nested={nested}
        onRename={onRename}
        onDone={() => setRenaming(false)}
      />
    );
  return (
    <TreeItem
      label={topic.name}
      nested={nested}
      count={topic.active_count}
      actions={
        <>
          <IconButton
            icon={Pencil}
            label={`Rename topic ${name}`}
            onClick={() => setRenaming(true)}
          />
          {/* Neutral at rest like Rename: the confirmation carries the danger. */}
          <IconButton icon={Trash2} label={`Delete topic ${name}`} onClick={onDelete} />
        </>
      }
    />
  );
}

/**
 * A topic's name, edited in place. Enter saves (Escape closes the dialog,
 * dropping the edit); a failed save keeps the typed name so the person can
 * retry, and an unchanged or empty name saves nothing.
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
      // Shown through the dialog's error; keep the typed name.
    } finally {
      setSaving(false);
    }
  };
  return (
    <TreeItemForm nested={nested} onSubmit={() => void submit()}>
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename explicitly opens this field; focus follows the invoking action.
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={`New name for ${name}`}
      />
      <Button type="submit" variant="secondary" disabled={saving || !draft.trim()}>
        Save
      </Button>
    </TreeItemForm>
  );
}
