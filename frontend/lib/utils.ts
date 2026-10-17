import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge classifies an unrecognised `text-*` class as a COLOUR, so the
 * Product-specific font-size utilities must be classified as sizes so they do
 * not conflict with semantic text colours.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            // Ladder rungs beyond the default t-shirt sizes — without these,
            // `text-field` + `text-danger-text` would collapse to the colour
            // and the text would lose its size.
            'field',
          ],
        },
      ],
    },
  },
});

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A table's own value for `key`. A plain object literal still inherits
 * `constructor`, `toString` and `__proto__`, so a bare lookup on an untrusted
 * key can return a function or the prototype instead of a value.
 */
export function ownValue<V>(table: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The entry for position `index`, wrapping around a list that is never empty. */
export function cycled<Items extends readonly [unknown, ...unknown[]]>(
  items: Items,
  index: number,
): Items[number] {
  return items[index % items.length] ?? items[0];
}

/**
 * Two-letter avatar initials from an email address, taken from the local part
 * (before the `@`) and upper-cased. Falls back to the raw value when there is
 * no `@`, and yields `''` for an empty string. Shared by the sidebar user menu
 * and the Settings account card so both avatars stay in sync.
 */
export function emailInitials(email: string) {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

/**
 * Title-case a snake_case lifecycle/status token for display
 * (`partially_completed` → `Partially Completed`). Shared by the run/execution
 * and Site Health status view-models so their labels stay byte-identical.
 */
export function titleCaseStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
