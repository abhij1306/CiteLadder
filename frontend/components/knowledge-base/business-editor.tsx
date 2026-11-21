import { useState, type ClipboardEvent, type ReactNode } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { ValuesInput, type ChipItem } from '@/components/ui/chip-input';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { SettingsGroup } from '@/components/ui/setting-row';
import { SLIP_FACE } from '@/components/ui/slip';
import { textRole } from '@/components/ui/typography';
import type { BusinessMap } from '@citeladder/contracts';
import { Check, Plus, X } from '@/lib/icons';
import { formatCount, pluralCount } from '@/lib/format';
import {
  acceptAll,
  acceptCell,
  showsServiceAreas,
  suggestionCount,
  withField,
  withOfferings,
  type BusinessDraft,
  type ContextListKey,
  type MapDimension,
  type MapEntryDraft,
} from '@/lib/prompts/builder-business';
import { BUSINESS_MODEL_CHOICES } from '@/lib/project/identity-facets';
import { cn } from '@/lib/utils';

type EditorProps = Readonly<{
  draft: BusinessDraft;
  onChange: (draft: BusinessDraft) => void;
  disabled: boolean;
  listMax: number;
}>;

type OfferingMap = BusinessDraft['maps'][number];

const DIMENSIONS = [
  { key: 'audiences', label: 'Who buys' },
  { key: 'situations', label: 'Situations' },
  { key: 'attributes', label: 'Attributes' },
] as const satisfies readonly { key: MapDimension; label: string }[];

const entryItems = (entries: readonly MapEntryDraft[]): ChipItem[] =>
  entries.map((entry) => ({ value: entry.value, suggested: entry.review_state === 'suggested' }));
const itemEntries = (items: readonly ChipItem[]): MapEntryDraft[] =>
  items.map((item) => ({
    value: item.value,
    review_state: item.suggested ? 'suggested' : 'confirmed',
  }));
const listItems = (values: readonly string[], suggested: boolean): ChipItem[] =>
  values.map((value) => ({ value, suggested }));

const ROW_GRID =
  'column-split:grid-cols-[minmax(9rem,22%)_repeat(3,minmax(0,1fr))_2.25rem] column-split:gap-0 grid gap-1';
const CELL = 'column-split:border-s column-split:border-rule min-w-0 column-split:p-1';
const FIELD_LABEL = textRole('caption', 'column-split:hidden px-2 pt-1');

export function SuggestionsNotice({ draft, onChange, disabled }: Omit<EditorProps, 'listMax'>) {
  const count = suggestionCount(draft);
  if (!count) return null;
  return (
    <Notice
      action={
        <Button variant="secondary" disabled={disabled} onClick={() => onChange(acceptAll(draft))}>
          <Icon icon={Check} />
          Accept all
        </Button>
      }
    >
      {pluralCount(count, 'suggestion')}
    </Notice>
  );
}

function OfferingRow({
  map,
  disabled,
  listMax,
  onChange,
  onRemove,
}: Readonly<{
  map: OfferingMap;
  disabled: boolean;
  listMax: number;
  onChange: (map: OfferingMap) => void;
  onRemove: () => void;
}>) {
  return (
    <li
      aria-label={map.offering}
      className={cn(ROW_GRID, 'border-rule column-split:p-0 border-b p-2')}
    >
      <div className="column-split:px-4 column-split:py-3 flex min-w-0 items-start justify-between gap-2 px-2 pt-1">
        <span className={textRole('label', 'min-w-0 break-words')}>{map.offering}</span>
        <IconButton
          icon={X}
          label={`Remove ${map.offering}`}
          disabled={disabled}
          onClick={onRemove}
          className="column-split:hidden"
        />
      </div>
      {DIMENSIONS.map((dimension) => (
        <div key={dimension.key} className={CELL}>
          <p aria-hidden className={FIELD_LABEL}>
            {dimension.label}
          </p>
          <ValuesInput
            variant="cell"
            separates="comma"
            label={`${dimension.label}: ${map.offering}`}
            items={entryItems(map[dimension.key])}
            onChange={(items) => onChange({ ...map, [dimension.key]: itemEntries(items) })}
            onAccept={() => onChange(acceptCell(map, dimension.key))}
            max={listMax}
            disabled={disabled}
          />
        </div>
      ))}
      <div className="column-split:flex column-split:border-s column-split:border-rule hidden items-start justify-center pt-2">
        <IconButton
          icon={X}
          label={`Remove ${map.offering}`}
          disabled={disabled}
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

function AddOffering({
  disabled,
  onAdd,
}: Readonly<{ disabled: boolean; onAdd: (names: string[]) => void }>) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    onAdd([name]);
    setName('');
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const names = event.clipboardData.getData('text').split(/[\n\r]+/);
    if (names.length < 2) return;
    event.preventDefault();
    onAdd([name, ...names]);
    setName('');
  };
  return (
    <div className="focus-frame border-rule flex min-h-10 items-center gap-2 border-t border-transparent px-4">
      <Icon icon={Plus} className="text-ink-2" />
      <input
        aria-label="Add offering"
        placeholder="Add offering"
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
        onBlur={add}
        onPaste={paste}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
        className="type-body text-ink placeholder:text-ink-2 min-h-8 flex-1 bg-transparent"
      />
    </div>
  );
}

export function OfferingsGrid({
  draft,
  onChange,
  disabled,
  listMax,
  saved,
}: EditorProps &
  Readonly<{
    saved: BusinessMap;
  }>) {
  const setOfferings = (offerings: string[]) => onChange(withOfferings(draft, offerings, saved));
  const add = (names: string[]) => {
    const next = [...draft.offerings];
    for (const raw of names) {
      const name = raw.trim();
      if (name && !next.some((item) => item.toLowerCase() === name.toLowerCase())) next.push(name);
    }
    setOfferings(next);
  };
  return (
    <SettingsGroup
      title="Offerings"
      status={
        <span className={textRole('caption', 'tabular-nums')}>
          {formatCount(draft.offerings.length)}
        </span>
      }
    >
      <div className={cn(SLIP_FACE, 'min-w-0 overflow-hidden')}>
        <div
          aria-hidden
          className={cn(
            ROW_GRID,
            'bg-well border-rule column-split:grid hidden h-[var(--table-header-height)] items-center border-b',
            textRole('captionStrong'),
          )}
        >
          <span className="px-4">Offering</span>
          {DIMENSIONS.map((dimension) => (
            <span key={dimension.key} className="px-3">
              {dimension.label}
            </span>
          ))}
          <span />
        </div>
        {draft.maps.length ? (
          <ul aria-label="Offerings" className="contents">
            {draft.maps.map((map, index) => (
              <OfferingRow
                key={map.offering}
                map={map}
                disabled={disabled}
                listMax={listMax}
                onChange={(next) =>
                  onChange({
                    ...draft,
                    maps: draft.maps.map((item, i) => (i === index ? next : item)),
                  })
                }
                onRemove={() =>
                  setOfferings(draft.offerings.filter((item) => item !== map.offering))
                }
              />
            ))}
          </ul>
        ) : null}
        <AddOffering disabled={disabled} onAdd={add} />
      </div>
    </SettingsGroup>
  );
}

const LISTS = [
  { key: 'buyerRoles', label: 'Buyer roles' },
  { key: 'serviceAreas', label: 'Service areas' },
  { key: 'categoryTerms', label: 'Category terms' },
  { key: 'jobs', label: 'Jobs to be done' },
] as const satisfies readonly { key: ContextListKey; label: string }[];

function FactRow({
  label,
  count,
  children,
}: Readonly<{ label: string; count?: string; children: ReactNode }>) {
  return (
    <div className="column-split:grid-cols-[10.5rem_minmax(0,1fr)] grid min-w-0 items-start gap-x-3 gap-y-1 px-4 py-2">
      <div className="column-split:pt-2.5">
        <p className={textRole('label')}>{label}</p>
        {count ? <p className={textRole('caption', 'tabular-nums')}>{count}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function BusinessFacts({
  draft,
  onChange,
  disabled,
  listMax,
  context,
}: EditorProps & Readonly<{ context: Record<string, unknown> }>) {
  const lists = LISTS.filter((list) => list.key !== 'serviceAreas' || showsServiceAreas(context));
  const savedModel = context.business_model;
  const unknownModel = typeof savedModel === 'string' && savedModel !== '' && !draft.businessModel;
  const accept = (key: ContextListKey | 'businessModel') =>
    onChange({ ...draft, suggested: draft.suggested.filter((item) => item !== key) });
  return (
    <SettingsGroup title="Business">
      <div className={cn(SLIP_FACE, 'divide-rule min-w-0 divide-y')}>
        {lists.map((list) => (
          <FactRow
            key={list.key}
            label={list.label}
            count={`${formatCount(draft[list.key].length)} of ${formatCount(listMax)}`}
          >
            <ValuesInput
              variant="cell"
              separates="comma"
              label={list.label}
              items={listItems(draft[list.key], draft.suggested.includes(list.key))}
              onChange={(items) =>
                onChange(
                  withField(
                    draft,
                    list.key,
                    items.map((item) => item.value),
                  ),
                )
              }
              onAccept={() => accept(list.key)}
              max={listMax}
              disabled={disabled}
            />
          </FactRow>
        ))}
        <FactRow label="Business model">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'rounded-control w-56 max-w-full',
                draft.suggested.includes('businessModel') &&
                  'border-control-line border border-dashed',
              )}
            >
              <Select
                ariaLabel="Business model"
                placeholder={unknownModel ? 'Unknown' : 'Not set'}
                value={draft.businessModel ?? undefined}
                options={BUSINESS_MODEL_CHOICES}
                disabled={disabled}
                onValueChange={(model) => onChange(withField(draft, 'businessModel', model))}
              />
            </div>
            {draft.suggested.includes('businessModel') ? (
              <IconButton
                icon={Check}
                label="Accept Business model"
                disabled={disabled}
                onClick={() => accept('businessModel')}
              />
            ) : null}
          </div>
        </FactRow>
      </div>
    </SettingsGroup>
  );
}
