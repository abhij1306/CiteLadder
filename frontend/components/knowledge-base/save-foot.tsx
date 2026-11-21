import { useId } from 'react';

import { Save } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';

const NO_CHANGES = 'No changes to save';

export function SaveFoot({
  label,
  changed,
  saving,
  onSave,
}: Readonly<{ label: string; changed: boolean; saving: boolean; onSave: () => void }>) {
  const reasonId = useId();
  const idle = !changed && !saving;
  return idle ? (
    <>
      <Tooltip content={NO_CHANGES} describe={false}>
        <Button
          variant="primary"
          aria-disabled="true"
          aria-describedby={reasonId}
          aria-label={label}
        >
          <Icon icon={Save} />
          Save
        </Button>
      </Tooltip>
      <span id={reasonId} hidden>
        {NO_CHANGES}
      </span>
    </>
  ) : (
    <Button
      variant="primary"
      onClick={onSave}
      disabled={saving}
      pending={saving}
      pendingLabel="Saving…"
      aria-label={label}
    >
      <Icon icon={Save} />
      Save
    </Button>
  );
}
