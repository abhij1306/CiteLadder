import { useState } from 'react';

import { FieldGroup } from '@/components/ui/checklist-field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { RadioGroup } from '@/components/ui/radio-group';
import type { DiscoveryProfile } from '@/lib/api/brand-discoveries';
import { BUYER_TYPE_CHOICES, MARKET_SCOPE_CHOICES } from '@/lib/project/identity-facets';
import { sentenceCaseStatus } from '@/lib/utils';

/**
 * Everything the user actually decides at onboarding.
 *
 * Three questions, all answered by clicking. Positioning, description, target
 * audience and the product list used to live here as textareas; they are brand
 * knowledge, they belong on the brand screen inside the app, and nobody writes
 * prose about their own company when creating a project. The model fills them,
 * they stay in the payload, and they are editable later where that work
 * belongs.
 *
 * "What you sell" is not one of three equal questions. Competitors, prompts and
 * every later score are derived from it, so a wrong category poisons the whole
 * project — and it is exactly the field the research model gets wrong on
 * businesses it half-recognises, most often by reading a firm that BUILDS
 * something as a firm that SELLS it. It therefore leads, carries the heavier
 * label, and states what it controls.
 */

export function hasConfirmedIcp(profile: DiscoveryProfile | null): profile is DiscoveryProfile {
  return Boolean(profile?.category.trim());
}

const MAX_CATEGORY_CHOICES = 3;
const OTHER_CATEGORY = '__other__';

function categoryChoices(profile: DiscoveryProfile): string[] {
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const candidate of [
    profile.category,
    ...profile.category_options,
    ...profile.category_aliases,
  ]) {
    const item = candidate.trim();
    const key = sentenceCaseStatus(item).toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    choices.push(item);
    if (choices.length === MAX_CATEGORY_CHOICES) break;
  }
  return choices;
}

type IcpPart = Readonly<{
  profile: DiscoveryProfile;
  onChange: (profile: DiscoveryProfile) => void;
}>;

export function IcpCategory({ profile, onChange, note }: IcpPart & Readonly<{ note?: string }>) {
  const update = <K extends keyof DiscoveryProfile>(key: K, value: DiscoveryProfile[K]) =>
    onChange({ ...profile, [key]: value });

  const [choices] = useState(() => categoryChoices(profile));
  const [isOther, setIsOther] = useState(() => !choices.includes(profile.category));

  return (
    <FieldGroup label="What you sell" note={note}>
      <Stack gap="compact">
        <RadioGroup
          ariaLabel="What you sell"
          value={isOther ? OTHER_CATEGORY : profile.category}
          options={[
            ...choices.map((option) => ({
              value: option,
              label: sentenceCaseStatus(option),
            })),
            {
              value: OTHER_CATEGORY,
              label: choices.length > 0 ? 'None of these' : 'Other',
            },
          ]}
          onValueChange={(value) => {
            if (value === OTHER_CATEGORY) {
              setIsOther(true);
              if (choices.includes(profile.category)) update('category', '');
            } else {
              setIsOther(false);
              update('category', value);
            }
          }}
        />
        {isOther ? (
          <Input
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- Choosing Other explicitly reveals this field; focus follows that user action.
            autoFocus
            aria-label="Describe what you sell"
            value={choices.includes(profile.category) ? '' : profile.category}
            onChange={(event) => update('category', event.target.value)}
            placeholder="e.g. ecommerce implementation agency"
          />
        ) : null}
      </Stack>
    </FieldGroup>
  );
}

export function IcpAudience({ profile, onChange }: IcpPart) {
  const update = <K extends keyof DiscoveryProfile>(key: K, value: DiscoveryProfile[K]) =>
    onChange({ ...profile, [key]: value });

  return (
    <>
      <FieldGroup label="Who buys it">
        <RadioGroup
          variant="cards"
          columns={3}
          ariaLabel="Who buys it"
          value={profile.business_type ?? ''}
          options={BUYER_TYPE_CHOICES}
          onValueChange={(value) => {
            if (value) update('business_type', value);
          }}
        />
      </FieldGroup>

      <FieldGroup label="Where they buy it">
        <RadioGroup
          variant="cards"
          columns={2}
          ariaLabel="Where they buy it"
          value={profile.market_scope ?? ''}
          options={MARKET_SCOPE_CHOICES}
          onValueChange={(value) => {
            if (value) update('market_scope', value);
          }}
        />
      </FieldGroup>
    </>
  );
}
