import type { DraftState } from '@/components/ui/draft-sheet';
import type { AgentRevision } from '@/lib/api/agent';

export function revisionDraft(revision: Pick<AgentRevision, 'author'>): Readonly<{
  state: DraftState;
  marker?: string;
}> {
  switch (revision.author) {
    case 'agent':
      return { state: 'draft' };
    case 'user':
      return { state: 'accepted', marker: 'Saved by you' };
    case 'fetch':
      return { state: 'accepted', marker: 'Fetched page' };
    default: {
      const unknown: never = revision.author;
      return unknown;
    }
  }
}
