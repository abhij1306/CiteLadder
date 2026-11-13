import { Check, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { FIELD_EDGE } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { cn } from '@/lib/utils';

/** One chip: a value, and whether it is still an unconfirmed suggestion. */
export type ChipItem = Readonly<{ value: string; suggested?: boolean }>;

const sameValue = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const CHIP_BUTTON =
  'focus-ring text-ink-secondary hover:overlay-hover hover:text-ink grid size-5 shrink-0 place-items-center rounded-xs transition-colors disabled:cursor-not-allowed';

/**
 * One value as a 24px `surface-sunken` chip with a 20px remove button. A
 * suggestion is marked "Suggested" and offers Confirm until a person accepts
 * it, so a model's guess never reads as a reviewed fact.
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
    <li className="bg-surface-sunken text-ink text-body-sm inline-flex h-6 max-w-full items-center gap-1 rounded-xs ps-2 pe-0.5 whitespace-nowrap">
      <span className="min-w-0 truncate" title={item.value}>
        {item.value}
      </span>
      {item.suggested ? (
        <span className="text-caption text-ink-muted shrink-0">Suggested</span>
      ) : null}
      {item.suggested ? (
        <button
          type="button"
          aria-label={`Confirm ${item.value}`}
          disabled={disabled}
          onClick={onConfirm}
          className={CHIP_BUTTON}
        >
          <Icon icon={Check} className="my-0" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${item.value}`}
        disabled={disabled}
        onClick={onRemove}
        className={CHIP_BUTTON}
      >
        <Icon icon={X} className="my-0" />
      </button>
    </li>
  );
}

/**
 * ChipInput — a list of short values as removable chips with an add field at
 * the end, all inside Input's box (36px minimum, the soft xs ring, `radius-md`),
 * wrapping to more lines as chips are added. Enter or leaving the field adds
 * what was typed; Backspace in an empty add field removes the last chip; a
 * repeat (any case) is ignored. A value is one entry however many commas it
 * holds, so an offering such as "bays for golf courses, and community
 * centres" stays one offering. With `max`, an "n/max" counter shows and the
 * add field stops at the limit. An owner that saves the typed but unadded
 * value too holds it through `pending` and `onPendingChange`.
 */
export function ChipInput({
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
  /** The most entries the owner accepts. */
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
  const add = () => {
    if (trimmed === '' || full || items.some((item) => sameValue(item.value, trimmed))) return;
    onChange([...items, { value: trimmed }]);
    setPending('');
  };
  return (
    // A named group: its chips are a list of the same name, and the add field
    // is "Add to …", so each part says what it belongs to.
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-body-sm text-ink mb-2">{label}</legend>
      {/* The add field grows to fill the rest of its line, so a press on the
          box's empty space lands in it. */}
      <div
        className={cn(
          'focus-frame flex min-h-[var(--control-md)] w-full cursor-text flex-wrap items-center gap-1 rounded-md p-1 transition-[border-color,box-shadow]',
          FIELD_EDGE,
          disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        {items.length ? (
          <ul aria-label={label} className="contents">
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
        ) : null}
        <input
          aria-label={`Add to ${label}`}
          value={pending}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled || full}
          onChange={(event) => setPending(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            } else if (event.key === 'Backspace' && pending === '' && items.length) {
              event.preventDefault();
              onChange(items.slice(0, -1));
            }
          }}
          className="text-ink placeholder:text-ink-muted text-body-sm h-6 min-w-36 flex-1 bg-transparent px-2 disabled:cursor-not-allowed"
        />
      </div>
      <ChipInputNote hintId={`${id}-hint`} hint={hint} count={items.length} max={max} />
    </fieldset>
  );
}

/** The hint on the left and, with `max`, the "n/max" counter on the right. */
function ChipInputNote({
  hintId,
  hint,
  count,
  max,
}: Readonly<{ hintId: string; hint?: string; count: number; max?: number }>) {
  if (!hint && max === undefined) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      {hint ? (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      ) : (
        <span />
      )}
      {max !== undefined ? (
        <span
          className={cn(
            'ms-auto shrink-0 font-mono text-caption',
            count >= max ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {`${count}/${max}`}
        </span>
      ) : null}
    </div>
  );
}

/** One read-only chip; `media` is a leading mark such as a `BrandMark`. */
export type StaticChip = ChipItem & Readonly<{ key?: string; media?: ReactNode }>;

/**
 * Short values read, not edited (a business map's roles, a project's
 * competitors), as one wrapping row of Tags. A suggestion says so. No values
 * reads "Not set".
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
    <ul aria-label={label} className="flex min-w-0 flex-wrap items-center gap-2">
      {items.map((item) => (
        <li key={item.key ?? item.value} className="max-w-full">
          <Tag>
            {item.media}
            <span className="min-w-0 truncate" title={item.value}>
              {item.value}
            </span>
            {item.suggested ? <span className="text-ink-muted shrink-0">Suggested</span> : null}
          </Tag>
        </li>
      ))}
    </ul>
  );
}
