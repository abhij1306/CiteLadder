import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Textarea } from '@/components/ui/textarea';
import { X } from '@/lib/icons';
import { agentWriteFailure } from '@/lib/agent/errors';
import { agentMutations, type AgentDocumentRef, type AgentRevision } from '@/lib/api/agent';
import { Notice } from '@/components/ui/notice';

/** An edit in progress, bound to the revision it started from. */
export type OutputDraft = {
  baseRevisionId: string;
  title: string;
  body: string;
};

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
        <Notice kind="mutation" notice={agentWriteFailure(save.error, 'save the output')} />
      ) : null}
      <Inline className="justify-end">
        <Button type="button" variant="quiet" onClick={onDone} disabled={save.isPending}>
          <Icon icon={X} />
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={unchanged || blank || save.isPending}>
          Save as new revision
        </Button>
      </Inline>
    </Stack>
  );
}
