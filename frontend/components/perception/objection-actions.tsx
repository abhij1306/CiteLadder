import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@/components/ui/menu';
import { Notice } from '@/components/ui/notice';
import { Ellipsis } from '@/lib/icons';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { probeMutations } from '@/lib/api/probes';
import type { ProjectScope } from '@/lib/api/query-keys/scope';

type Group = Readonly<{ id: string; name: string }>;

export function ObjectionActions({
  scope,
  group,
  others,
}: Readonly<{ scope: ProjectScope; group: Group; others: readonly Group[] }>) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rename = useMutation(probeMutations.renameGroup(scope));
  const merge = useMutation(probeMutations.mergeGroup(scope));
  const remove = useMutation(probeMutations.removeGroup(scope));
  const failed = [
    { mutation: merge, action: 'merge the objection' },
    { mutation: remove, action: 'delete the objection' },
  ].find(({ mutation }) => mutation.isError);
  const closeRename = () => {
    rename.reset();
    setRenaming(null);
  };
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton icon={Ellipsis} label={`Actions for ${group.name}`} tooltip={false} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setRenaming(group.name)}>Rename</MenuItem>
          {others.length ? (
            <MenuSub>
              <MenuSubTrigger>Merge into</MenuSubTrigger>
              <MenuSubContent>
                {others.map((other) => (
                  <MenuItem
                    key={other.id}
                    onSelect={() => merge.mutate({ id: group.id, intoId: other.id })}
                  >
                    {other.name}
                  </MenuItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          ) : null}
          <MenuItem danger onSelect={() => setDeleting(true)}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
      {failed ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(failed.mutation.error, { action: failed.action })}
        />
      ) : null}
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => (open ? undefined : closeRename())}
        title="Rename objection"
        footer={
          <>
            <Button variant="quiet" onClick={closeRename}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!renaming?.trim()}
              pending={rename.isPending}
              onClick={() =>
                rename.mutate(
                  { id: group.id, name: renaming?.trim() ?? '' },
                  { onSuccess: closeRename },
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        <Stack gap="item">
          {rename.isError ? (
            <Notice
              kind="mutation"
              notice={mutationNoticeForError(rename.error, { action: 'rename the objection' })}
            />
          ) : null}
          <Input
            aria-label="Objection name"
            value={renaming ?? ''}
            onChange={(event) => setRenaming(event.target.value)}
          />
        </Stack>
      </Dialog>
      <ConfirmDialog
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        request={
          deleting
            ? {
                title: `Delete "${group.name}"?`,
                body: 'Its scores go with it. A later probe can raise it again.',
                confirmLabel: 'Delete objection',
                destructive: true,
                onConfirm: () => remove.mutate(group.id, { onSettled: () => setDeleting(false) }),
              }
            : null
        }
      />
    </>
  );
}
