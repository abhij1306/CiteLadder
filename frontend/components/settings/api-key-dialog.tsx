import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import {
  DEFAULT_EXPIRY,
  EXPIRY_PRESET_DAYS,
  addDays,
  dayInZone,
  presetLabelDate,
  resolveExpiry,
  type ExpiryChoice,
} from '@/components/settings/api-key-expiry';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { textRole } from '@/components/ui/typography';
import {
  apiKeyScopeSchema,
  type ApiKeyCreated,
  type ApiKeyScope,
} from '@citeladder/contracts/api-keys';
import { apiKeyMutations } from '@/lib/api/api-keys';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

type KeyAccess = 'read' | 'write';

const SCOPES_FOR = {
  read: ['read'],
  write: apiKeyScopeSchema.options,
} as const satisfies Record<KeyAccess, readonly ApiKeyScope[]>;

function expiryOptions(today: string) {
  return [
    ...EXPIRY_PRESET_DAYS.map((days) => ({
      value: `${days}` as const,
      label: (
        <>
          {days === 1 ? '1 day' : `${days} days`}{' '}
          <span className="text-ink-2">({presetLabelDate(addDays(today, days), today)})</span>
        </>
      ),
    })),
    { value: 'custom' as const, label: 'Custom' },
    { value: 'never' as const, label: <span className="text-negative">Never</span> },
  ];
}

type ProjectChoice = ReadonlySet<string> | null;

function ProjectsField({
  value,
  onChange,
}: Readonly<{ value: ProjectChoice; onChange: (choice: ProjectChoice) => void }>) {
  const { projects } = useProjectContext();
  const toggle = (chosen: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <Stack as="fieldset" gap="tight">
      <legend className={textRole('label')}>Projects</legend>
      <RadioGroup
        ariaLabel="Projects the key can reach"
        value={value === null ? 'all' : 'chosen'}
        onValueChange={(mode) => onChange(mode === 'all' ? null : new Set())}
        options={[
          { value: 'all', label: 'All projects' },
          { value: 'chosen', label: 'Chosen projects' },
        ]}
      />
      {value === null
        ? null
        : projects.map((project) => (
            <Checkbox
              key={project.id}
              label={project.name}
              checked={value.has(project.id)}
              onCheckedChange={(on) => toggle(value, project.id, on === true)}
            />
          ))}
    </Stack>
  );
}

function CreatedKey({ secret }: Readonly<{ secret: string }>) {
  return (
    <Stack gap="compact">
      <Notice tone="warning">Shown once.</Notice>
      <code className="type-code break-all">{secret}</code>
      <div>
        <CopyButton value={secret}>Copy key</CopyButton>
      </div>
    </Stack>
  );
}

function AccessField({
  value,
  onChange,
  mayWrite,
}: Readonly<{ value: KeyAccess; onChange: (access: KeyAccess) => void; mayWrite: boolean }>) {
  const write = mayWrite
    ? { value: 'write' as const, label: 'Read and write' }
    : {
        value: 'write' as const,
        label: 'Read and write',
        disabled: true,
        description: 'Capped at your role.',
      };
  return (
    <Stack as="fieldset" gap="tight">
      <legend className={textRole('label')}>Access</legend>
      <RadioGroup
        ariaLabel="What the key can do"
        value={value}
        onValueChange={onChange}
        options={[{ value: 'read', label: 'Read' }, write]}
      />
    </Stack>
  );
}

function ExpiryFields({
  today,
  timeZone,
  choice,
  onChoice,
  customDay,
  onCustomDay,
  error,
}: Readonly<{
  today: string;
  timeZone: string;
  choice: ExpiryChoice;
  onChoice: (choice: ExpiryChoice) => void;
  customDay: string;
  onCustomDay: (day: string) => void;
  error: string | undefined;
}>) {
  return (
    <>
      <Field label="Expires" hint={`Ends at midnight, ${timeZone}`}>
        {(props) => (
          <Select
            id={props.id}
            aria-describedby={props['aria-describedby']}
            ariaLabel="Expires"
            className="w-full"
            value={choice}
            onValueChange={onChoice}
            options={expiryOptions(today)}
          />
        )}
      </Field>
      {choice === 'custom' ? (
        <Field label="Expiry date" error={customDay === '' ? undefined : error}>
          {(props) => (
            <DateField
              id={props.id}
              aria-describedby={props['aria-describedby']}
              aria-invalid={props['aria-invalid']}
              ariaLabel="Expiry date"
              min={today}
              value={customDay}
              onChange={onCustomDay}
            />
          )}
        </Field>
      ) : null}
    </>
  );
}

export function CreateKeyDialog({
  openedAt,
  workspaceId,
  onClose,
}: Readonly<{ openedAt: Date | null; workspaceId: string; onClose: () => void }>) {
  const mayWrite = useWorkspaceCapability('write');
  const [name, setName] = useState('');
  const [access, setAccess] = useState<KeyAccess>('read');
  const [projectIds, setProjectIds] = useState<ProjectChoice>(null);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(DEFAULT_EXPIRY);
  const [customDay, setCustomDay] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const create = useMutation(apiKeyMutations.create(workspaceId));
  const timeZone = useDisplayTimeZone();
  const today = dayInZone(openedAt ?? new Date(0), timeZone);
  const expiry = resolveExpiry({ choice: expiryChoice, customDay, today, timeZone });
  const ready = name.trim() !== '' && projectIds?.size !== 0 && expiry.kind !== 'invalid';
  const createKey = () => {
    if (expiry.kind === 'invalid') return;
    create.mutate(
      {
        name,
        scopes: [...SCOPES_FOR[access]],
        project_ids: projectIds && [...projectIds],
        expires_at: expiry.kind === 'at' ? expiry.expiresAt : null,
      },
      { onSuccess: setCreated },
    );
  };
  const close = () => {
    setName('');
    setAccess('read');
    setProjectIds(null);
    setExpiryChoice(DEFAULT_EXPIRY);
    setCustomDay('');
    setCreated(null);
    create.reset();
    onClose();
  };

  return (
    <Dialog
      open={openedAt !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={created ? 'Copy your API key' : 'Create an API key'}
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            pending={create.isPending}
            disabled={!ready}
            onClick={createKey}
          >
            Create key
          </Button>
        )
      }
    >
      {created ? (
        <CreatedKey secret={created.secret} />
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
          <AccessField value={access} onChange={setAccess} mayWrite={mayWrite} />
          <ProjectsField value={projectIds} onChange={setProjectIds} />
          <ExpiryFields
            today={today}
            timeZone={timeZone}
            choice={expiryChoice}
            onChoice={setExpiryChoice}
            customDay={customDay}
            onCustomDay={setCustomDay}
            error={expiry.kind === 'invalid' ? expiry.message : undefined}
          />
          {create.isError ? (
            <Notice
              kind="mutation"
              notice={mutationNoticeForError(create.error, { action: 'create the API key' })}
            />
          ) : null}
        </Stack>
      )}
    </Dialog>
  );
}
