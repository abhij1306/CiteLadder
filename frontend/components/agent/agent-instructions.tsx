import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { SaveFoot } from '@/components/knowledge-base/save-foot';
import { Absence } from '@/components/ui/absence';
import { DisplayTime } from '@/components/ui/display-time';
import { Textarea } from '@/components/ui/textarea';
import { agentMutations, agentQueries } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { SettingRows, SettingsGroup } from '@/components/ui/setting-row';

export function useAgentInstructions(workspaceId: string, projectId: string) {
  const scope = { workspaceId, projectId };
  const query = useQuery(agentQueries.instructions(scope));
  const mayEdit = useWorkspaceCapability('run');
  const text = query.data?.text ?? '';
  const [edit, setEdit] = useState<{ text: string | null; baseline: string; version: number }>({
    text: null,
    baseline: text,
    version: 0,
  });
  const draft = edit.text ?? text;
  const save = useMutation(agentMutations.saveInstructions(scope));
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
    changed: draft.trim() !== text.trim(),
    saving: save.isPending,
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

export function AgentInstructionsCard({
  instructions,
}: Readonly<{ instructions: AgentInstructions }>) {
  const { query, draft, mayEdit, saveError } = instructions;
  return (
    <SettingsGroup
      title="Agent instructions"
      description={
        query.data?.created_at ? (
          <>
            Saved <DisplayTime value={query.data.created_at} />
          </>
        ) : undefined
      }
    >
      {query.isPending ? (
        <StateBlock
          kind="loading"
          label="Loading agent instructions…"
          shape={{ kind: 'facts', rows: 1 }}
        />
      ) : null}
      {query.isError ? (
        <StateBlock
          kind="error"
          {...readErrorProps(query)}
          title="Couldn't load the agent instructions"
          fallback="Agent instructions could not be loaded."
        />
      ) : null}
      {saveError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(saveError, { action: 'save the instructions' })}
          onRetry={instructions.retry}
        />
      ) : null}
      {query.data ? (
        <SettingRows
          foot={
            mayEdit ? (
              <SaveFoot
                label="Save instructions"
                changed={instructions.changed}
                saving={instructions.saving}
                onSave={instructions.save}
              />
            ) : null
          }
        >
          {!query.data.created_at && !mayEdit ? (
            <Absence state="none" />
          ) : (
            <div>
              <label htmlFor="agent-instructions-text" className="sr-only">
                Agent instructions
              </label>
              <Textarea
                id="agent-instructions-text"
                value={draft}
                onChange={(event) => instructions.setDraft(event.target.value)}
                rows={8}
                readOnly={!mayEdit}
                placeholder={
                  mayEdit
                    ? 'For example: Write for Australian parents. Plain, warm tone. Never promise delivery dates.'
                    : undefined
                }
              />
            </div>
          )}
        </SettingRows>
      ) : null}
    </SettingsGroup>
  );
}
