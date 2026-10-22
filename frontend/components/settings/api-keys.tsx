import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { DisplayTime } from '@/components/ui/display-time';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { RadioGroup } from '@/components/ui/radio-group';
import { ReadError } from '@/components/ui/read-error';
import { TagGroup } from '@/components/ui/tag';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import type { ApiKey, ApiKeyCreated, ApiKeyScope } from '@citeladder/contracts/api-keys';
import { apiKeysApi } from '@/lib/api/api-keys';
import { humanizeApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { API_HOST_ORIGIN } from '@/lib/config/api-host';
import { useProjectContext } from '@/lib/project/project-context';

const API_BASE_URL = `${API_HOST_ORIGIN}/v1`;

/** What each scope lets a key do; `read` is always granted. */
const SCOPES: readonly { value: ApiKeyScope; label: string }[] = [
  { value: 'read', label: 'Read reports and settings' },
  {
    value: 'prompts:write',
    label: 'Edit prompts and topics, run prompt generation',
  },
  { value: 'competitors:write', label: 'Edit tracked competitors' },
  { value: 'audits:run', label: 'Launch and cancel audits' },
  { value: 'schedules:write', label: 'Edit audit schedules' },
  {
    value: 'actions:write',
    label: 'Update actions and record implementations',
  },
];

const STATE_LABELS: Record<ApiKey['state'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

function KeyRow({
  apiKey,
  projectNames,
  onRevoke,
}: Readonly<{
  apiKey: ApiKey;
  projectNames: ReadonlyMap<string, string>;
  onRevoke: () => void;
}>) {
  const projects =
    apiKey.project_ids === null
      ? 'All projects'
      : apiKey.project_ids.map((id) => projectNames.get(id) ?? 'A deleted project').join(', ');
  return (
    <TableRow>
      <TableCell>
        <div className="grid min-w-0">
          <ClampText lines={1} className={textRole('itemTitle')}>
            {apiKey.name}
          </ClampText>
          <ClampText lines={1} className={textRole('caption')}>
            <code>{apiKey.prefix}…</code> · {STATE_LABELS[apiKey.state]} ·{' '}
            {apiKey.created_by_email ? `Created by ${apiKey.created_by_email} · ` : null}
            Created <DisplayTime value={apiKey.created_at} dateOnly />
            {apiKey.expires_at ? (
              <>
                {' '}
                · Expires <DisplayTime value={apiKey.expires_at} dateOnly />
              </>
            ) : null}
          </ClampText>
        </div>
      </TableCell>
      <TableCell>
        <TagGroup labels={apiKey.scopes} />
      </TableCell>
      <TableCell>
        <ClampText lines={1}>{projects}</ClampText>
      </TableCell>
      <TableCell>
        {apiKey.last_used_at ? <DisplayTime value={apiKey.last_used_at} /> : 'Not used yet'}
      </TableCell>
      <TableCell numeric="end">
        {apiKey.state === 'active' ? (
          <Button variant="secondary" onClick={onRevoke}>
            Revoke
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

const KEY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'key', label: 'Key' },
  { key: 'scopes', label: 'Access', width: 'name' },
  { key: 'projects', label: 'Projects', width: 'status' },
  { key: 'used', label: 'Last used', width: 'date' },
  {
    key: 'revoke',
    label: 'Revoke',
    width: 'action',
    numeric: 'end',
    hideLabel: true,
  },
];

function CreateKeyDialog({
  open,
  workspaceId,
  onClose,
}: Readonly<{ open: boolean; workspaceId: string; onClose: () => void }>) {
  const cache = useQueryClient();
  const { projects } = useProjectContext();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ReadonlySet<ApiKeyScope>>(new Set(['read']));
  const [projectMode, setProjectMode] = useState<'all' | 'chosen'>('all');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [expiresOn, setExpiresOn] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const create = useMutation({
    mutationFn: () =>
      apiKeysApi.create(workspaceId, {
        name,
        scopes: [...scopes],
        project_ids: projectMode === 'all' ? null : [...chosen],
        // The end of the chosen day where the person is, sent as an instant.
        expires_at: expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null,
      }),
    onSuccess: (result) => {
      setCreated(result);
      return cache.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
  const toggle = <T,>(set: ReadonlySet<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const close = () => {
    setName('');
    setScopes(new Set(['read']));
    setProjectMode('all');
    setChosen(new Set());
    setExpiresOn('');
    setCreated(null);
    create.reset();
    onClose();
  };
  const ready = name.trim() !== '' && (projectMode === 'all' || chosen.size > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={created ? 'Copy your API key' : 'Create an API key'}
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <Button pending={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
            Create key
          </Button>
        )
      }
    >
      {created ? (
        <Stack gap="compact">
          <Alert tone="warning">You won’t see this key again. Store it somewhere safe now.</Alert>
          <code className="type-caption break-all">{created.secret}</code>
          <div>
            <CopyButton value={created.secret}>Copy key</CopyButton>
          </div>
        </Stack>
      ) : (
        <Stack gap="compact">
          <Field label="Name" required>
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Stack as="fieldset" gap="tight">
            <legend className={textRole('label')}>What the key can do</legend>
            {SCOPES.map((scope) => (
              <Checkbox
                key={scope.value}
                label={scope.label}
                checked={scope.value === 'read' || scopes.has(scope.value)}
                disabled={scope.value === 'read'}
                onCheckedChange={(on) => setScopes(toggle(scopes, scope.value, on === true))}
              />
            ))}
            <p className={textRole('caption')}>
              A key never does more than the role of the person who created it allows.
            </p>
          </Stack>
          <RadioGroup
            ariaLabel="Projects the key can reach"
            value={projectMode}
            onValueChange={setProjectMode}
            options={[
              { value: 'all', label: 'All projects' },
              { value: 'chosen', label: 'Chosen projects' },
            ]}
          />
          {projectMode === 'chosen' ? (
            <Stack as="fieldset" gap="tight">
              <legend className={textRole('label')}>Projects</legend>
              {projects.map((project) => (
                <Checkbox
                  key={project.id}
                  label={project.name}
                  checked={chosen.has(project.id)}
                  onCheckedChange={(on) => setChosen(toggle(chosen, project.id, on === true))}
                />
              ))}
            </Stack>
          ) : null}
          <Field label="Expires" hint="Optional. The key stops working at the end of this day.">
            {(props) => (
              <DateField
                id={props.id}
                aria-describedby={props['aria-describedby']}
                ariaLabel="Expiry date"
                value={expiresOn}
                onChange={setExpiresOn}
              />
            )}
          </Field>
          {create.isError ? (
            <Alert tone="danger">{humanizeApiError(create.error).message}</Alert>
          ) : null}
        </Stack>
      )}
    </Dialog>
  );
}

/** Keys in use, and the create action. */
function keysToolbar({ live, onCreate }: Readonly<{ live: number; onCreate: () => void }>) {
  return {
    status: live === 1 ? '1 key in use' : `${live} keys in use`,
    actions: <Button onClick={onCreate}>Create key</Button>,
  };
}

export function ApiKeys() {
  const cache = useQueryClient();
  const { activeWorkspaceId, projects } = useProjectContext();
  const workspaceId = activeWorkspaceId ?? '';
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<ApiKey | null>(null);
  const query = useQuery({
    queryKey: queryKeys.apiKeys.list(workspaceId),
    queryFn: ({ signal }) => apiKeysApi.list(workspaceId, signal),
    enabled: workspaceId !== '',
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => apiKeysApi.revoke(workspaceId, keyId),
    onSuccess: () => {
      setPending(null);
      return cache.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
  if (query.isPending) return <output>Loading API keys…</output>;
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="API keys could not be loaded."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  const { keys } = query.data;
  const live = keys.filter((key) => key.state === 'active').length;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <Stack gap="section">
      <Stack as="section" gap="compact">
        <EditorialSectionHeader
          title="API keys"
          description={`Read your reports and manage prompts, competitors, audits and actions from your own code through the REST API at ${API_BASE_URL}.`}
        />
      </Stack>
      <DataTable
        title="Keys"
        toolbar={keysToolbar({ live, onCreate: () => setCreating(true) })}
        columns={KEY_COLUMNS}
        state={
          keys.length === 0
            ? {
                kind: 'empty',
                icon: KeyRound,
                headingLevel: 3,
                heading: 'No API keys yet.',
              }
            : undefined
        }
      >
        {keys.map((key) => (
          <KeyRow
            key={key.id}
            apiKey={key}
            projectNames={projectNames}
            onRevoke={() => {
              revoke.reset();
              setPending(key);
            }}
          />
        ))}
      </DataTable>
      <CreateKeyDialog
        open={creating}
        workspaceId={workspaceId}
        onClose={() => setCreating(false)}
      />
      <ConfirmDialog
        pending={revoke.isPending}
        onCancel={() => setPending(null)}
        request={
          pending && {
            title: `Revoke ${pending.name}?`,
            confirmLabel: 'Revoke',
            destructive: true,
            onConfirm: () => revoke.mutate(pending.id),
            body: (
              <Stack gap="compact">
                <p>Requests with this key are refused at once. This cannot be undone.</p>
                {revoke.isError ? (
                  <Alert tone="danger">{humanizeApiError(revoke.error).message}</Alert>
                ) : null}
              </Stack>
            ),
          }
        }
      />
    </Stack>
  );
}
