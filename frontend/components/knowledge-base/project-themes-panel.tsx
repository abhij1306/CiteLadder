import { useMutation, useQuery } from '@tanstack/react-query';

import { AddNameForm, EditableNameRow } from '@/components/knowledge-base/editable-names';
import { Absence } from '@/components/ui/absence';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { SettingRows } from '@/components/ui/setting-row';
import { StateBlock } from '@/components/ui/state-block';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { themeMutations, themeQueries } from '@/lib/api/project-themes';
import type { ProjectScope } from '@/lib/api/query-keys/scope';

export function ProjectThemesPanel({
  scope,
  mayEdit,
}: Readonly<{ scope: ProjectScope; mayEdit: boolean }>) {
  const themes = useQuery(themeQueries.list(scope));
  const create = useMutation(themeMutations.create(scope));
  const rename = useMutation(themeMutations.rename(scope));
  const remove = useMutation(themeMutations.remove(scope));
  const failed = [
    { mutation: create, action: 'add the theme' },
    { mutation: rename, action: 'rename the theme' },
    { mutation: remove, action: 'delete the theme' },
  ].find(({ mutation }) => mutation.isError);
  const pending = create.isPending || rename.isPending || remove.isPending;
  if (themes.isPending)
    return <StateBlock kind="loading" label="Loading themes…" shape={{ kind: 'list' }} />;
  if (themes.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(themes)}
        title="Couldn't load themes"
        fallback="Themes could not be loaded."
      />
    );
  return (
    <div className="grid min-w-0 gap-3">
      {failed ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(failed.mutation.error, { action: failed.action })}
        />
      ) : null}
      <SettingRows label="Themes">
        {themes.data.map((theme) => (
          <EditableNameRow
            key={theme.id}
            name={theme.name}
            verb="Rename"
            mayEdit={mayEdit}
            pending={pending}
            onSave={(name) => rename.mutateAsync({ theme, name })}
            onDelete={() => remove.mutateAsync(theme)}
          />
        ))}
        {themes.data.length || mayEdit ? null : <Absence label="No themes" />}
        {mayEdit ? (
          <AddNameForm
            title="Add a theme"
            field="Theme"
            submit="Add theme"
            pending={pending}
            onAdd={(name) => create.mutateAsync(name)}
          />
        ) : null}
      </SettingRows>
    </div>
  );
}
