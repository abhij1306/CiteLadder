import type { ConfirmRequest } from '@/components/ui/dialog';
import { pluralCount } from '@/lib/format';
import type { Prompt, Topic } from '@citeladder/contracts';

export type PendingDelete =
  | { kind: 'prompt'; prompt: Prompt }
  | { kind: 'prompts'; prompts: readonly Prompt[] }
  | { kind: 'topic'; topic: Topic };

function copy(pending: PendingDelete): { title: string; description: string; confirm: string } {
  switch (pending.kind) {
    case 'prompt':
      return {
        title: 'Delete this prompt?',
        description: 'Past results are kept.',
        confirm: 'Delete',
      };
    case 'prompts': {
      const prompts = pluralCount(pending.prompts.length, 'prompt');
      return {
        title: `Delete ${prompts}?`,
        description: 'Past results are kept.',
        confirm: `Delete ${prompts}`,
      };
    }
    case 'topic': {
      const count = pending.topic.active_count;
      return {
        title: `Delete topic “${pending.topic.name}”?`,
        description: count
          ? `Its ${pluralCount(count, 'active prompt')}, other prompts and subtopics stay, without a topic.`
          : 'Its prompts and subtopics stay, without a topic.',
        confirm: 'Delete',
      };
    }
    default: {
      const unhandled: never = pending;
      return unhandled;
    }
  }
}

export function deleteRequest(
  pending: PendingDelete | null,
  onConfirm: () => void,
): ConfirmRequest | null {
  if (!pending) return null;
  const { title, description, confirm } = copy(pending);
  return { title, body: description, confirmLabel: confirm, destructive: true, onConfirm };
}
