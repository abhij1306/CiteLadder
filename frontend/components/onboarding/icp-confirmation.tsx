'use client';

import { useState } from 'react';

import { FlowGroup } from '@/components/onboarding/flow-shell';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import type { DiscoveryProfile } from '@/lib/api/brand-discoveries';
import { BUYER_TYPE_CHOICES, MARKET_SCOPE_CHOICES } from '@/lib/project/identity-facets';
import { titleCaseStatus } from '@/lib/utils';

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
  // Only the fields on this screen can gate it. Requiring invisible prose would
  // block the user on something they were never shown.
  return Boolean(profile?.category.trim());
}

const MAX_CATEGORY_CHOICES = 3;
const OTHER_CATEGORY = '__other__';

/** Suggestions come only from model-supplied fields, never the live value. */
function categoryChoices(profile: DiscoveryProfile): string[] {
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const candidate of [
    profile.category,
    ...profile.category_options,
    ...profile.category_aliases,
  ]) {
    const item = candidate.trim();
    // Keyed on what the chip will SAY, not on what it stores: two tokens that
    // differ only by an underscore render the same word and would otherwise
    // produce two identical chips.
    const key = titleCaseStatus(item).toLowerCase();
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

/**
 * What you sell — the field every other answer on this screen is derived from,
 * so it leads the step at full width rather than sharing a column with the two
 * questions it governs. Its options are sentences, not words, which is also the
 * reason they are a ruled list: as chips, the long one became a two-line box
 * beside a set of small ones and the set stopped reading as a set.
 */
export function IcpCategory({ profile, onChange }: IcpPart) {
  const update = <K extends keyof DiscoveryProfile>(key: K, value: DiscoveryProfile[K]) =>
    onChange({ ...profile, [key]: value });

  // Captured once so the list cannot shift under the user as they edit.
  const [choices] = useState(() => categoryChoices(profile));
  const [isOther, setIsOther] = useState(() => !choices.includes(profile.category));

  return (
    <FlowGroup
      className="flow-review-card"
      title="What you sell"
      help="Your competitors and tracked questions are built from this."
    >
      <RadioGroup
        variant="row"
        className="border-y-0"
        ariaLabel="What you sell"
        value={isOther ? OTHER_CATEGORY : profile.category}
        options={[
          // The value stays exactly as discovery supplied it — this is only
          // the label. `brand_audit_services` was the first thing a new
          // customer read on this screen.
          ...choices.map((option) => ({
            value: option,
            label: titleCaseStatus(option),
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
        <div className="pt-1">
          <Input
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- Choosing Other explicitly reveals this field; focus follows that user action.
            autoFocus
            aria-label="Describe what you sell"
            value={choices.includes(profile.category) ? '' : profile.category}
            onChange={(event) => update('category', event.target.value)}
            placeholder="e.g. ecommerce implementation agency"
            className="max-w-md"
          />
        </div>
      ) : null}
    </FlowGroup>
  );
}

/** Who the buyer is and where they are — the two short questions. */
export function IcpAudience({ profile, onChange }: IcpPart) {
  const update = <K extends keyof DiscoveryProfile>(key: K, value: DiscoveryProfile[K]) =>
    onChange({ ...profile, [key]: value });

  return (
    <>
      <FlowGroup title="Who buys it">
        <RadioGroup
          variant="chip"
          ariaLabel="Who buys it"
          value={profile.business_type ?? ''}
          options={BUYER_TYPE_CHOICES}
          onValueChange={(value) => {
            if (value) update('business_type', value);
          }}
        />
      </FlowGroup>

      <FlowGroup title="Where they buy it">
        <RadioGroup
          variant="chip"
          ariaLabel="Where they buy it"
          value={profile.market_scope ?? ''}
          options={MARKET_SCOPE_CHOICES}
          onValueChange={(value) => {
            if (value) update('market_scope', value);
          }}
        />
      </FlowGroup>
    </>
  );
}
