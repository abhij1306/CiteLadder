import { useMutation } from '@tanstack/react-query';

import type { Project } from '@citeladder/contracts';

import { AddNameForm, EditableNameRow } from '@/components/knowledge-base/editable-names';
import { Absence } from '@/components/ui/absence';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { SettingRow, SettingRows, SettingsGroup } from '@/components/ui/setting-row';
import { Tag } from '@/components/ui/tag';
import { Check } from '@/lib/icons';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { projectMutations } from '@/lib/api/projects';

export function BrandAliasesPanel({
  project,
  mayEdit,
}: Readonly<{ project: Project; mayEdit: boolean }>) {
  const save = useMutation(
    projectMutations.update({ workspaceId: project.workspace_id, projectId: project.id }),
  );
  const aliases = project.brand.aliases;
  const saveAliases = (next: readonly string[]) =>
    save.mutateAsync({ brand: { aliases: [...new Set(next.map((alias) => alias.trim()))] } });
  const suggestions = project.brand.alias_suggestions;
  return (
    <>
      <SettingsGroup title="Aliases">
        {save.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(save.error, { action: 'save the aliases' })}
          />
        ) : null}
        <SettingRows label="Aliases">
          {aliases.map((alias, index) => (
            <EditableNameRow
              key={alias}
              name={alias}
              verb="Edit"
              mayEdit={mayEdit}
              pending={save.isPending}
              onSave={(next) => saveAliases(aliases.map((old, at) => (at === index ? next : old)))}
              onDelete={() => saveAliases(aliases.filter((_, at) => at !== index))}
            />
          ))}
          {aliases.length || mayEdit ? null : <Absence label="No aliases" />}
          {mayEdit ? (
            <AddNameForm
              title="Add an alias"
              field="Alias"
              submit="Add alias"
              pending={save.isPending}
              onAdd={(alias) => saveAliases([...aliases, alias])}
            />
          ) : null}
        </SettingRows>
      </SettingsGroup>
      {mayEdit && suggestions.length ? (
        <SettingsGroup title="Suggested aliases">
          <SettingRows>
            {suggestions.map((suggestion) => (
              <SettingRow
                key={suggestion}
                label={<Tag kind="draft">{suggestion}</Tag>}
                action={
                  <Button
                    variant="secondary"
                    disabled={save.isPending}
                    aria-label={`Keep ${suggestion}`}
                    onClick={() =>
                      void saveAliases([...aliases, suggestion]).catch(() => undefined)
                    }
                  >
                    <Icon icon={Check} />
                    Keep
                  </Button>
                }
              />
            ))}
          </SettingRows>
        </SettingsGroup>
      ) : null}
    </>
  );
}
