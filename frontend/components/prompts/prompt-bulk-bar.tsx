import { useMutation } from '@tanstack/react-query';
import { useId, type ComponentProps } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { SelectionDock } from '@/components/ui/selection-dock';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { ChevronDown, X } from '@/lib/icons';
import { promptsMutations, type PromptBulkChange } from '@/lib/api/prompts';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { formatCount, pluralCount } from '@/lib/format';
import type { Prompt, Topic } from '@citeladder/contracts';

type Selected = readonly Prompt[];

const FAILED = {
  status: 'change these prompts',
  topic: 'move these prompts',
  delete: 'delete these prompts',
} as const satisfies Record<PromptBulkChange['kind'], string>;

function doneMessage(change: PromptBulkChange, count: number, topics: readonly Topic[]) {
  const prompts = pluralCount(count, 'prompt');
  switch (change.kind) {
    case 'status':
      return `${prompts} ${change.status === 'active' ? 'activated' : 'archived'}`;
    case 'topic': {
      const name = topics.find((topic) => topic.id === change.topicId)?.name;
      return name ? `${prompts} moved to ${name}` : `${prompts} taken out of their topic`;
    }
    case 'delete':
      return `${prompts} deleted`;
    default: {
      const unhandled: never = change;
      return unhandled;
    }
  }
}

export function usePromptBulk(
  scope: ProjectScope,
  { topics, onDone }: Readonly<{ topics: readonly Topic[]; onDone: () => void }>,
) {
  const mutation = useMutation(promptsMutations.bulk(scope));
  const toast = useToast();
  const run = (change: PromptBulkChange, prompts: Selected) =>
    mutation.mutate(
      { change, prompts },
      {
        onSuccess: (count) => {
          toast.notify(doneMessage(change, count, topics));
          onDone();
        },
        onError: (error) =>
          toast.notify(
            `Couldn't ${FAILED[change.kind]}`,
            mutationNoticeForError(error, { action: FAILED[change.kind] }).message,
            { tone: 'negative' },
          ),
      },
    );
  return { run, pending: mutation.isPending };
}

function activateHold(selected: Selected): string | null {
  const beyond = selected.filter((prompt) => prompt.over_plan_limit).length;
  if (beyond > 0)
    return `${pluralCount(beyond, 'selected prompt')} ${beyond === 1 ? 'is' : 'are'} beyond your plan's prompt limit; delete prompts or upgrade to activate ${beyond === 1 ? 'it' : 'them'}`;
  if (selected.every((prompt) => prompt.status === 'active'))
    return 'These prompts are already active';
  return null;
}

function archiveHold(selected: Selected): string | null {
  if (selected.every((prompt) => prompt.status === 'archived'))
    return 'These prompts are already archived';
  return null;
}

function HeldButton({
  hold,
  onClick,
  ...props
}: Readonly<
  Omit<ComponentProps<typeof Button>, 'onClick'> & { hold: string | null; onClick: () => void }
>) {
  const reasonId = useId();
  if (hold === null) return <Button {...props} onClick={onClick} />;
  return (
    <>
      <Tooltip content={hold} describe={false}>
        <Button {...props} aria-disabled="true" aria-describedby={reasonId} />
      </Tooltip>
      <span id={reasonId} hidden>
        {hold}
      </span>
    </>
  );
}

export function PromptBulkBar({
  selected,
  topics,
  max,
  pending,
  onClear,
  onChange,
  onDelete,
}: Readonly<{
  selected: Selected;
  topics: readonly Topic[];
  max: number;
  pending: boolean;
  onClear: () => void;
  onChange: (change: PromptBulkChange) => void;
  onDelete: () => void;
}>) {
  const held =
    (pending ? 'Changing the selected prompts' : null) ??
    (selected.length > max ? `Select up to ${max} prompts at a time` : null);
  return (
    <SelectionDock
      label="Selected prompts"
      summary={selected.length > 0 ? `${formatCount(selected.length)} selected` : null}
    >
      <HeldButton
        hold={held ?? activateHold(selected)}
        onClick={() => onChange({ kind: 'status', status: 'active' })}
      >
        Activate
      </HeldButton>
      <HeldButton
        hold={held ?? archiveHold(selected)}
        onClick={() => onChange({ kind: 'status', status: 'archived' })}
      >
        Archive
      </HeldButton>
      <Menu>
        <MenuTrigger asChild disabled={held !== null}>
          <Button>
            Assign topic
            <Icon icon={ChevronDown} className="opacity-80" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          {topics.map((topic) => (
            <MenuItem
              key={topic.id}
              onSelect={() => onChange({ kind: 'topic', topicId: topic.id })}
            >
              {topic.name}
            </MenuItem>
          ))}
          {topics.length > 0 ? <MenuSeparator /> : null}
          <MenuItem onSelect={() => onChange({ kind: 'topic', topicId: null })}>No topic</MenuItem>
        </MenuContent>
      </Menu>
      <HeldButton variant="danger" hold={held} onClick={onDelete}>
        Delete
      </HeldButton>
      <IconButton icon={X} label="Clear selection" onClick={onClear} />
    </SelectionDock>
  );
}
