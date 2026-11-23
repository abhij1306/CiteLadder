import { useId, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Pencil, Plus, Settings2, Trash2 } from '@/lib/icons';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import type { FilterDefinition } from '@/components/ui/all-filters';
import { DefaultHint } from '@/components/ui/filter-options';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { TreeItem, TreeItemForm, TreeList } from '@/components/ui/list-row';
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '@/components/ui/menu';
import { Select } from '@/components/ui/select';
import { ControlCount } from '@/components/ui/tabs';
import type { Topic } from '@citeladder/contracts';
import { orderTopicsForRail } from '@/lib/prompts/topic-tree';

import type { useTopicMutations } from './use-topic-mutations';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type TopicMutations = ReturnType<typeof useTopicMutations>;

type TopicsLoadError = RetryableRead | null;

function TopicsLoadNotice({ read }: Readonly<{ read: RetryableRead }>) {
  return (
    <Notice
      kind="read"
      {...readErrorProps(read)}
      title="Couldn't load topics"
      fallback="The request failed or timed out."
    />
  );
}

const ALL_TOPICS = '';

export function topicFilter({
  topics,
  selectedTopicId,
  onSelect,
  manage,
}: Readonly<{
  topics: readonly Topic[];
  selectedTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  manage?: Readonly<{ onAdd: () => void; onManage: () => void }>;
}>): FilterDefinition {
  const ordered = orderTopicsForRail(topics);
  const selected = ordered.find(({ topic }) => topic.id === selectedTopicId);
  return {
    kind: 'custom',
    id: 'topic',
    label: 'Topic',
    icon: 'topic',
    valueLabel: selected?.label ?? 'All topics',
    isDefault: selectedTopicId === null,
    defaultLabel: 'All topics',
    reset: () => onSelect(null),
    content: (
      <>
        <MenuRadioGroup value={selectedTopicId ?? ALL_TOPICS}>
          <MenuRadioItem value={ALL_TOPICS} onSelect={() => onSelect(null)}>
            <span className="flex min-w-0 items-center">
              All topics
              <DefaultHint />
            </span>
          </MenuRadioItem>
          {ordered.map(({ topic, label }) => (
            <MenuRadioItem key={topic.id} value={topic.id} onSelect={() => onSelect(topic.id)}>
              {label}
              <ControlCount count={topic.active_count} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {manage ? (
          <>
            <MenuSeparator />
            <MenuItem icon={<Icon icon={Plus} />} onSelect={manage.onAdd}>
              Add topic
            </MenuItem>
            <MenuItem icon={<Icon icon={Settings2} />} onSelect={manage.onManage}>
              Manage topics…
            </MenuItem>
          </>
        ) : null}
      </>
    ),
  };
}

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
    } catch {}
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add topic"
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
        {error ? <Notice kind="mutation" notice={error} /> : null}
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
  loadError: TopicsLoadError;
  onAdd: () => void;
  onDelete: (topic: Topic) => void;
}>) {
  const createFailed = mutations.create.isError;
  return (
    <>
      {loadError ? <TopicsLoadNotice read={loadError} /> : null}
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

export function ManageTopicsDialog({
  open,
  onOpenChange,
  topics,
  onRename,
  onDelete,
  onAdd,
  loadError = null,
  actionError,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: readonly Topic[];
  onRename: (topic: Topic, name: string) => Promise<void>;
  onDelete: (topic: Topic) => void;
  onAdd: () => void;
  loadError?: TopicsLoadError;
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
      {loadError ? <TopicsLoadNotice read={loadError} /> : null}
      {!loadError && actionError ? <Notice kind="mutation" notice={actionError} /> : null}
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
      ) : null}
      {!ordered.length && !loadError ? (
        <StateBlock kind="empty" inline message="No topics yet." />
      ) : null}
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
          <IconButton icon={Trash2} label={`Delete topic ${name}`} onClick={onDelete} />
        </>
      }
    />
  );
}

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
    } finally {
      setSaving(false);
    }
  };
  return (
    <TreeItemForm nested={nested} onSubmit={() => void submit()}>
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus
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
