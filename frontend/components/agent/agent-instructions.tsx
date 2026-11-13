import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { agentMutations, agentQueries } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * The project's Agent instructions and their draft. The draft follows the
 * persisted text until it is edited; a local edit survives background
 * refreshes and a save that lands after later typing. The page places the
 * save action, so the state lives here rather than in the card.
 */
export function useAgentInstructions(workspaceId: string, projectId: string) {
  const scope = { workspaceId, projectId };
  const query = useQuery(agentQueries.instructions(scope));
  const mayEdit = useWorkspaceCapability('run');
  const text = query.data?.text ?? '';
  // Null follows persisted data; a local edit survives background refreshes.
  const [edit, setEdit] = useState<{ text: string | null; baseline: string; version: number }>({
    text: null,
    baseline: text,
    version: 0,
  });
  const draft = edit.text ?? text;
  const save = useMutation(agentMutations.saveInstructions(scope));
  /**
   * Send `submitted`. The draft clears only when nothing was typed after it
   * (the edit version and text still match); later typing stays the draft.
   */
  const submit = (submitted: string) => {
    const submittedVersion = edit.version;
    save.mutate(submitted, {
      onSuccess: (saved) =>
        setEdit((current) => ({
          text:
            current.version === submittedVersion && draft === submitted
              ? null
              : (current.text ?? current.baseline),
          baseline: saved.text,
          version: current.version,
        })),
    });
  };
  return {
    query,
    draft,
    mayEdit,
    /** Something to save: loaded, editable, changed and not already saving. */
    canSave: Boolean(query.data) && mayEdit && draft.trim() !== text.trim() && !save.isPending,
    save: () => submit(draft),
    saveError: save.isError ? save.error : null,
    retry: () => {
      if (save.variables !== undefined) submit(save.variables);
    },
    setDraft: (next: string) =>
      setEdit((current) => ({
        text: next === text ? null : next,
        baseline: text,
        version: current.version + 1,
      })),
  };
}

type AgentInstructions = ReturnType<typeof useAgentInstructions>;

/** The Agent instructions tab: audience, voice and standing requirements, read-only without `run`. */
export function AgentInstructionsCard({
  instructions,
}: Readonly<{ instructions: AgentInstructions }>) {
  const { query, draft, mayEdit, saveError } = instructions;
  return (
    <Card aria-labelledby="agent-instructions">
      <CardHeader>
        <CardTitle id="agent-instructions">Agent instructions</CardTitle>
        <CardDescription>
          Audience, voice and standing requirements the agent follows in every chat for this
          project.
        </CardDescription>
      </CardHeader>
      {query.isPending ? <QueryState kind="loading" label="Loading agent instructions…" /> : null}
      {query.isError ? (
        <QueryState
          kind="error"
          {...readErrorProps(query)}
          fallback="Agent instructions could not be loaded."
        />
      ) : null}
      {query.data ? (
        <Stack gap="compact">
          <label htmlFor="agent-instructions-text" className="sr-only">
            Agent instructions
          </label>
          <Textarea
            id="agent-instructions-text"
            value={draft}
            onChange={(event) => instructions.setDraft(event.target.value)}
            rows={8}
            readOnly={!mayEdit}
            placeholder="For example: Write for Australian parents. Plain, warm tone. Never promise delivery dates."
          />
          {saveError ? (
            <MutationNotice
              notice={mutationNoticeForError(saveError, { action: 'save the instructions' })}
              onRetry={instructions.retry}
            />
          ) : null}
          <span className={textRole('caption')}>
            {query.data.created_at ? (
              <>
                Saved <DisplayTime value={query.data.created_at} />
              </>
            ) : (
              'Not set'
            )}
          </span>
        </Stack>
      ) : null}
    </Card>
  );
}
