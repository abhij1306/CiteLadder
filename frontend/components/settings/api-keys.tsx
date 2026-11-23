import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

import { CreateKeyDialog } from '@/components/settings/api-key-dialog';
import { Button, IconButton } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { textRole } from '@/components/ui/typography';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText } from '@/components/ui/clamp-text';
import { TableActionsCell, TableCell, TableRow } from '@/components/ui/table';
import type { ApiKey, ApiKeyList } from '@citeladder/contracts/api-keys';
import { KeyRound, MoreHorizontal, Trash2, XCircle } from '@/lib/icons';
import { apiKeyMutations, apiKeyQueries } from '@/lib/api/api-keys';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { formatCount } from '@/lib/format';
import { API_HOST_ORIGIN } from '@/lib/config/api-host';
import { useProjectContext } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { SettingsGroup } from '@/components/ui/setting-row';
import { StateBlock } from '@/components/ui/state-block';
import { StatusMark } from '@/components/ui/status-mark';

const API_BASE_URL = `${API_HOST_ORIGIN}/v1`;

function KeyStateMark({ state }: Readonly<{ state: ApiKey['state'] }>) {
  switch (state) {
    case 'active':
      return (
        <StatusMark variant="status" value="success">
          Active
        </StatusMark>
      );
    case 'expired':
      return (
        <StatusMark variant="status" value="warning">
          Expired
        </StatusMark>
      );
    case 'revoked':
      return <StatusMark>Revoked</StatusMark>;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

type KeyRequest = { kind: 'revoke' | 'delete'; key: ApiKey };

function KeyMenu({
  apiKey,
  onRequest,
}: Readonly<{ apiKey: ApiKey; onRequest: (kind: KeyRequest['kind']) => void }>) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon={MoreHorizontal} label={`${apiKey.name} actions`} />
      </MenuTrigger>
      <MenuContent align="end">
        {apiKey.state === 'active' ? (
          <MenuItem icon={<Icon icon={XCircle} />} onSelect={() => onRequest('revoke')}>
            Revoke
          </MenuItem>
        ) : null}
        <MenuItem icon={<Icon icon={Trash2} />} danger onSelect={() => onRequest('delete')}>
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function KeyRow({
  apiKey,
  projectNames,
  onRequest,
}: Readonly<{
  apiKey: ApiKey;
  projectNames: ReadonlyMap<string, string>;
  onRequest: (kind: KeyRequest['kind']) => void;
}>) {
  const projects =
    apiKey.project_ids === null
      ? 'All projects'
      : apiKey.project_ids.map((id) => projectNames.get(id) ?? 'A deleted project').join(', ');
  const writes = apiKey.scopes.some((scope) => scope !== 'read');
  return (
    <TableRow>
      <TableCell>
        <div className="grid min-w-0">
          <ClampText tooltip={apiKey.name}>{apiKey.name}</ClampText>
          <code className={textRole('caption', 'truncate')}>{apiKey.prefix}…</code>
        </div>
      </TableCell>
      <TableCell>
        <KeyStateMark state={apiKey.state} />
      </TableCell>
      <TableCell>
        <div className="grid min-w-0">
          <span>{writes ? 'Read and write' : 'Read'}</span>
          <ClampText tooltip={projects} className={textRole('caption')}>
            {projects}
          </ClampText>
        </div>
      </TableCell>
      <TableCell>
        {apiKey.expires_at ? (
          <DisplayTime value={apiKey.expires_at} dateOnly />
        ) : (
          <span className="text-ink-2">Never</span>
        )}
      </TableCell>
      <TableCell>
        {apiKey.last_used_at ? (
          <DisplayTime value={apiKey.last_used_at} dateOnly />
        ) : (
          <span className="text-ink-2">Not used yet</span>
        )}
      </TableCell>
      <TableActionsCell>
        <KeyMenu apiKey={apiKey} onRequest={onRequest} />
      </TableActionsCell>
    </TableRow>
  );
}

const KEY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'key', label: 'Key', kind: 'identity' },
  { key: 'status', label: 'Status', kind: 'status', width: 'status' },
  { key: 'access', label: 'Actions', kind: 'text', width: 'name' },
  { key: 'expires', label: 'Expires', kind: 'date', width: 'date' },
  { key: 'used', label: 'Last used', kind: 'date', width: 'date', priority: 'low' },
  { key: 'menu', label: 'Key actions', kind: 'actions', width: 'control', hideLabel: true },
];

const liveKeys = (keys: readonly ApiKey[]) => keys.filter((key) => key.state === 'active').length;

function KeysHeadActions({
  list,
  onCreate,
}: Readonly<{ list: ApiKeyList | undefined; onCreate: () => void }>) {
  if (!list) return null;
  const live = liveKeys(list.keys);
  return (
    <>
      <span className={textRole('caption', 'text-ink-2')}>
        {live === 1 ? '1 key in use' : `${formatCount(live)} keys in use`}
      </span>
      <Button onClick={onCreate}>Create key</Button>
    </>
  );
}

function ApiKeysBody({
  query,
  projectNames,
  onRequest,
}: Readonly<{
  query: UseQueryResult<ApiKeyList>;
  projectNames: ReadonlyMap<string, string>;
  onRequest: (request: KeyRequest) => void;
}>) {
  if (query.isPending)
    return (
      <StateBlock kind="loading" label="Loading API keys…" shape={{ kind: 'table', columns: 6 }} />
    );
  if (query.isError)
    return (
      <StateBlock
        kind="error"
        title="Couldn't load API keys"
        fallback="API keys could not be loaded."
        {...readErrorProps(query)}
      />
    );
  const { keys } = query.data;
  return (
    <>
      {keys.length === 0 ? (
        <StateBlock
          kind="empty"
          icon={KeyRound}
          heading="No API keys yet"
          description="Create a key to call the REST API from your own code."
        />
      ) : null}
      {keys.length === 0 ? null : (
        <DataTable label="API keys" columns={KEY_COLUMNS}>
          {keys.map((key) => (
            <KeyRow
              key={key.id}
              apiKey={key}
              projectNames={projectNames}
              onRequest={(kind) => onRequest({ kind, key })}
            />
          ))}
        </DataTable>
      )}
    </>
  );
}

const REQUEST_COPY = {
  revoke: { verb: 'Revoke', action: 'revoke the API key' },
  delete: { verb: 'Delete', action: 'delete the API key' },
} as const satisfies Record<KeyRequest['kind'], { verb: string; action: string }>;

function requestBody(request: KeyRequest): string {
  if (request.kind === 'revoke') return 'Cannot be undone.';
  return request.key.state === 'active'
    ? 'Stops the key working and removes it from this list. Cannot be undone.'
    : 'Removes the key from this list. Cannot be undone.';
}

export function ApiKeys() {
  const { activeWorkspaceId, projects } = useProjectContext();
  const workspaceId = activeWorkspaceId ?? '';
  const [creatingAt, setCreatingAt] = useState<Date | null>(null);
  const [pending, setPending] = useState<KeyRequest | null>(null);
  const query = useQuery({ ...apiKeyQueries.list(workspaceId), enabled: workspaceId !== '' });
  const revoke = useMutation(apiKeyMutations.revoke(workspaceId));
  const remove = useMutation(apiKeyMutations.remove(workspaceId));
  const mutation = pending?.kind === 'delete' ? remove : revoke;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <>
      <SettingsGroup
        title="API keys"
        region={false}
        description={
          <>
            <code className={textRole('code', 'break-words')}>{API_BASE_URL}</code>{' '}
            <CopyButton
              value={API_BASE_URL}
              iconOnly
              variant="quiet"
              className="align-middle"
              copiedLabel="Copied the API address"
            />
          </>
        }
        action={<KeysHeadActions list={query.data} onCreate={() => setCreatingAt(new Date())} />}
      >
        <ApiKeysBody
          query={query}
          projectNames={projectNames}
          onRequest={(request) => {
            revoke.reset();
            remove.reset();
            setPending(request);
          }}
        />
      </SettingsGroup>
      <CreateKeyDialog
        openedAt={creatingAt}
        workspaceId={workspaceId}
        onClose={() => setCreatingAt(null)}
      />
      <ConfirmDialog
        pending={mutation.isPending}
        onCancel={() => setPending(null)}
        request={
          pending && {
            title: `${REQUEST_COPY[pending.kind].verb} ${pending.key.name}?`,
            confirmLabel: REQUEST_COPY[pending.kind].verb,
            destructive: true,
            onConfirm: () => {
              const done = { onSuccess: () => setPending(null) };
              if (pending.kind === 'delete') remove.mutate(pending.key.id, done);
              else revoke.mutate(pending.key.id, done);
            },
            body: (
              <Stack gap="compact">
                <p>{requestBody(pending)}</p>
                {mutation.isError ? (
                  <Notice
                    kind="mutation"
                    notice={mutationNoticeForError(mutation.error, {
                      action: REQUEST_COPY[pending.kind].action,
                    })}
                  />
                ) : null}
              </Stack>
            ),
          }
        }
      />
    </>
  );
}
