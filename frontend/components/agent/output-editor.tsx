'use client';

import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Textarea } from '@/components/ui/textarea';
import { agentWriteFailure } from '@/lib/agent/errors';
import { agentMutations, type AgentDocumentRef, type AgentRevision } from '@/lib/api/agent';

/** An edit in progress, bound to the revision it started from. */
export type OutputDraft = {
  baseRevisionId: string;
  title: string;
  body: string;
};

/**
 * A direct edit: saved as a new user revision on top of the one being edited.
 * The base is frozen when editing starts, so if the output moved on meanwhile
 * the server refuses the stale edit and nothing is lost — the draft stays.
 */
export function OutputEditor({
  workspaceId,
  target,
  revision,
  draft,
  onChange,
  onDone,
}: Readonly<{
  workspaceId: string;
  target: AgentDocumentRef;
  revision: AgentRevision;
  draft: OutputDraft;
  onChange: (draft: OutputDraft) => void;
  onDone: () => void;
}>) {
  const { title, body } = draft;
  const save = useMutation(agentMutations.editOutput(workspaceId));
  const unchanged = title === revision.title && body === revision.body;
  const blank = !title.trim() || !body.trim();
  const titleId = `agent-output-title-${target.outputId}`,
    bodyId = `agent-output-body-${target.outputId}`;
  return (
    <Stack
      as="form"
      gap="compact"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        // The descriptor refreshes the chat and its revisions before this closes the editor.
        save.mutate(
          { ...target, baseRevisionId: draft.baseRevisionId, title, body },
          { onSuccess: onDone },
        );
      }}
    >
      <label htmlFor={titleId} className="sr-only">
        Output title
      </label>
      <Input
        id={titleId}
        value={title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <label htmlFor={bodyId} className="sr-only">
        Output body (Markdown)
      </label>
      <Textarea
        id={bodyId}
        value={body}
        rows={18}
        onChange={(event) => onChange({ ...draft, body: event.target.value })}
        className="tabular-nums"
      />
      {save.isError ? (
        <Callout tone="negative">{agentWriteFailure(save.error).message}</Callout>
      ) : null}
      <Inline className="justify-end">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={unchanged || blank || save.isPending}>
          Save as new revision
        </Button>
      </Inline>
    </Stack>
  );
}
