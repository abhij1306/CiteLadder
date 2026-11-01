'use client';

import { Check, Plus, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { cn } from '@/lib/utils';

/** One chip: a value, and whether it is still an unconfirmed suggestion. */
export type ChipItem = Readonly<{ value: string; suggested?: boolean }>;

const sameValue = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The chip face: the 32px control height, edge and radius; a suggestion's edge is dashed. */
const chipFaceClasses = (suggested: boolean | undefined, className: string) =>
  cn(
    'type-control text-foreground bg-input inline-flex h-[var(--control-height-md)] max-w-full items-center rounded-[var(--radius-control)] border',
    suggested ? 'border-border-strong border-dashed' : 'border-border',
    className,
  );

const CHIP_ROW = 'flex min-w-0 flex-wrap items-center gap-2';

/**
 * One value as a removable chip on the 32px control face. A suggestion keeps
 * a dashed edge and offers Confirm until a person accepts it, so a model's
 * guess never reads as a reviewed fact.
 */
function Chip({
  item,
  disabled,
  onRemove,
  onConfirm,
}: Readonly<{
  item: ChipItem;
  disabled?: boolean;
  onRemove: () => void;
  onConfirm: () => void;
}>) {
  return (
    <li className={chipFaceClasses(item.suggested, 'gap-1 ps-3')}>
      <span className="min-w-0 truncate">{item.value}</span>
      {item.suggested ? <span className="type-caption shrink-0">Suggested</span> : null}
      {item.suggested ? (
        <button
          type="button"
          aria-label={`Confirm ${item.value}`}
          disabled={disabled}
          onClick={onConfirm}
          className="focus-ring text-secondary hover:text-foreground disabled:text-muted grid h-full w-7 shrink-0 place-items-center rounded-[var(--radius-control)]"
        >
          <Icon icon={Check} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${item.value}`}
        disabled={disabled}
        onClick={onRemove}
        className="focus-ring text-secondary hover:text-foreground disabled:text-muted grid h-full w-7 shrink-0 place-items-center rounded-[var(--radius-control)]"
      >
        <Icon icon={X} />
      </button>
    </li>
  );
}

/**
 * An editable list of short values as chips, with one field to add more. A
 * value is one entry however many commas it holds, so an offering such as
 * "bays for golf courses, and community centres" stays one offering. The
 * typed value is added on Enter or Add; a repeat (any case) is not added.
 * An owner that saves the typed but unadded value too holds it through
 * `pending` and `onPendingChange`.
 */
export function ChipListField({
  label,
  hint,
  items,
  onChange,
  placeholder,
  disabled,
  max,
  pending: heldPending,
  onPendingChange,
}: Readonly<{
  label: string;
  hint?: string;
  items: readonly ChipItem[];
  onChange: (items: ChipItem[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** The most entries the owner accepts; Add stops there. */
  max?: number;
  /** The typed value, when the owner holds it. */
  pending?: string;
  onPendingChange?: (value: string) => void;
}>) {
  const id = useId();
  const [ownPending, setOwnPending] = useState('');
  const pending = heldPending ?? ownPending;
  const setPending = onPendingChange ?? setOwnPending;
  const trimmed = pending.trim();
  const full = max !== undefined && items.length >= max;
  const canAdd = trimmed !== '' && !full && !items.some((item) => sameValue(item.value, trimmed));
  const add = () => {
    if (!canAdd) return;
    onChange([...items, { value: trimmed }]);
    setPending('');
  };
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className={textRole('label')}>{label}</legend>
      {items.length ? (
        <ul aria-label={label} className={CHIP_ROW}>
          {items.map((item) => (
            <Chip
              key={item.value}
              item={item}
              disabled={disabled}
              onRemove={() => onChange(items.filter((other) => other !== item))}
              onConfirm={() =>
                onChange(items.map((other) => (other === item ? { value: other.value } : other)))
              }
            />
          ))}
        </ul>
      ) : (
        <UnavailableValue state="not_set" />
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Input
          value={pending}
          placeholder={placeholder}
          aria-label={`Add to ${label}`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled || full}
          onChange={(event) => setPending(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled || !canAdd}>
          <Icon icon={Plus} />
          Add
        </Button>
      </div>
      {hint ? (
        <span id={`${id}-hint`} className="type-caption">
          {hint}
        </span>
      ) : null}
    </fieldset>
  );
}

/** One read-only chip; `media` is a leading mark such as a `BrandLogo` at its `row` placement. */
export type StaticChip = ChipItem & Readonly<{ key?: string; media?: ReactNode }>;

/**
 * Short values read, not edited, as one wrapping row of chips on the same face
 * as `ChipListField`'s (a business map's roles, a project's competitors), so a
 * value looks the same where it is reviewed and where it is edited. A
 * suggestion keeps its dashed edge and says so. No values reads "Not set".
 */
export function ChipList({
  label,
  items,
}: Readonly<{
  /** Names the list when nothing visible does. */
  label?: string;
  items: readonly StaticChip[];
}>) {
  if (!items.length) return <UnavailableValue state="not_set" />;
  return (
    <ul aria-label={label} className={CHIP_ROW}>
      {items.map((item) => (
        <li key={item.key ?? item.value} className={chipFaceClasses(item.suggested, 'gap-2 px-3')}>
          {item.media}
          <span className="min-w-0 truncate">{item.value}</span>
          {item.suggested ? <span className="type-caption shrink-0">Suggested</span> : null}
        </li>
      ))}
    </ul>
  );
}
