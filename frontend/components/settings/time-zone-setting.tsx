import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { SettingsSection } from '@/components/ui/settings-section';
import { textRole } from '@/components/ui/typography';
import {
  saveTimeZonePreference,
  useDisplayTimeZone,
  useTimeZonePreference,
} from '@/lib/display-timezone';

type Choice = 'auto' | 'UTC' | 'custom';

const CHOICES: readonly { value: Choice; label: string }[] = [
  { value: 'auto', label: 'Auto (device timezone)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'custom', label: 'Named timezone' },
];

export function TimeZoneSetting() {
  const preference = useTimeZonePreference();
  const displayZone = useDisplayTimeZone();
  const [edit, setEdit] = useState<{ choice: Choice; namedZone: string } | null>(null);
  const savedChoice = preference === 'auto' || preference === 'UTC' ? preference : 'custom';
  const savedNamedZone = savedChoice === 'custom' ? preference : '';
  const choice = edit?.choice ?? savedChoice;
  const namedZone = edit?.namedZone ?? savedNamedZone;
  const [error, setError] = useState('');

  const choose = (next: Choice) => {
    setError('');
    if (next === 'custom') {
      setEdit({ choice: next, namedZone });
    } else if (saveTimeZonePreference(next)) {
      setEdit(null);
    } else {
      setEdit({ choice: next, namedZone });
      setError('The timezone preference could not be saved on this device.');
    }
  };

  const saveNamedZone = () => {
    if (saveTimeZonePreference(namedZone.trim())) {
      setEdit(null);
      setError('');
    } else {
      setError('Enter a valid IANA timezone, such as Asia/Kolkata.');
    }
  };

  return (
    <SettingsSection
      title="Display timezone"
      description={`Timestamps currently display in ${displayZone}.`}
    >
      <Select
        value={choice}
        onValueChange={choose}
        options={CHOICES}
        ariaLabel="Display timezone preference"
        className="max-w-sm"
      />
      {choice === 'custom' ? (
        <Stack gap="tight">
          <label htmlFor="named-display-timezone" className={textRole('label')}>
            IANA timezone
          </label>
          <Inline className="flex-wrap">
            <Input
              id="named-display-timezone"
              value={namedZone}
              onChange={(event) => {
                setEdit({ choice: 'custom', namedZone: event.target.value });
              }}
              placeholder="Asia/Kolkata"
              className="min-w-56 flex-1"
              aria-invalid={Boolean(error)}
            />
            <Button onClick={saveNamedZone}>Save timezone</Button>
          </Inline>
        </Stack>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </SettingsSection>
  );
}
