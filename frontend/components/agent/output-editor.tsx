'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { agentWriteFailure } from '@/lib/agent/errors';
import { agentMutations, type AgentRevision } from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';

/** An edit in progress, bound to the revision it started from. */
export type OutputDraft = { baseRevisionId: string; title: string; body: string };

/**
 * A direct edit: saved as a new user revision on top of the one being edited.
 * The base is frozen when editing starts, so if the output moved on meanwhile
 * the server refuses the stale edit and nothing is lost — the draft stays.
 */
export function OutputEditor({
  workspaceId,
  chatId,
  revision,
  draft,
  onChange,
  onDone,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  revision: AgentRevision;
  draft: OutputDraft;
  onChange: (draft: OutputDraft) => void;
  onDone: () => void;
}>) {
  const { title, body } = draft;
  const queryClient = useQueryClient();
  const save = useMutation({
    ...agentMutations.editOutput(workspaceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.revisions(chatId) }),
      ]);
      onDone();
    },
  });
  const unchanged = title === revision.title && body === revision.body;
  const blank = !title.trim() || !body.trim();
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ chatId, baseRevisionId: draft.baseRevisionId, title, body });
      }}
    >
      <label htmlFor="agent-output-title" className="sr-only">
        Output title
      </label>
      <Input
        id="agent-output-title"
        value={title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <label htmlFor="agent-output-body" className="sr-only">
        Output body (Markdown)
      </label>
      <Textarea
        id="agent-output-body"
        value={body}
        rows={18}
        onChange={(event) => onChange({ ...draft, body: event.target.value })}
        className="tabular-nums"
      />
      {save.isError ? <Alert tone="danger">{agentWriteFailure(save.error).message}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={unchanged || blank || save.isPending}>
          Save as new revision
        </Button>
      </div>
    </form>
  );
}
