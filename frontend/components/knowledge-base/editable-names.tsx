import { useState } from 'react';

import { Pencil, Plus, Save, Trash2, X } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline } from '@/components/ui/layout';
import { SettingField, SettingRow } from '@/components/ui/setting-row';
import { textRole } from '@/components/ui/typography';

export function AddNameForm({
  title,
  field,
  submit: submitLabel,
  pending,
  onAdd,
}: Readonly<{
  title: string;
  field: string;
  submit: string;
  pending: boolean;
  onAdd: (name: string) => Promise<unknown>;
}>) {
  const [draft, setDraft] = useState('');
  const submit = async () => {
    const sent = draft;
    try {
      await onAdd(sent.trim());
    } catch {
      return;
    }
    setDraft((current) => (current === sent ? '' : current));
  };
  const empty = !draft.trim();
  return (
    <form
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || empty) return;
        void submit();
      }}
    >
      <SettingField label={field}>
        {(props) => (
          <Inline className="flex-wrap">
            <Input
              {...props}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-56 flex-1"
            />
            <Button type="submit" disabled={pending || empty}>
              <Icon icon={Plus} />
              {submitLabel}
            </Button>
          </Inline>
        )}
      </SettingField>
    </form>
  );
}

export function EditableNameRow({
  name,
  verb,
  mayEdit,
  pending,
  onSave,
  onDelete,
}: Readonly<{
  name: string;
  verb: string;
  mayEdit: boolean;
  pending: boolean;
  onSave: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState<string | null>(null);
  const label =
    editing === null ? (
      <span className={textRole('body')}>{name}</span>
    ) : (
      <Input
        aria-label={`${verb} ${name}`}
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
      />
    );
  if (!mayEdit) return <SettingRow label={label} />;
  const actions =
    editing === null ? (
      <Inline as="span" className="flex-wrap">
        <Button variant="secondary" aria-label={`${verb} ${name}`} onClick={() => setEditing(name)}>
          <Icon icon={Pencil} />
          {verb}
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          aria-label={`Delete ${name}`}
          onClick={() => void onDelete().catch(() => undefined)}
        >
          <Icon icon={Trash2} />
          Delete
        </Button>
      </Inline>
    ) : (
      <Inline as="span" className="flex-wrap">
        <Button variant="quiet" onClick={() => setEditing(null)}>
          <Icon icon={X} />
          Cancel
        </Button>
        <Button
          variant="secondary"
          disabled={pending || !editing.trim()}
          onClick={() => {
            const sent = editing;
            onSave(sent.trim()).then(
              () => setEditing((current) => (current === sent ? null : current)),
              () => undefined,
            );
          }}
        >
          <Icon icon={Save} />
          Save
        </Button>
      </Inline>
    );
  return <SettingRow label={label} action={actions} />;
}
