import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: { radius: ['mark', 'control', 'card', 'overlay'] },
    classGroups: {
      'font-size': [
        {
          text: [
            'display-lg',
            'display-md',
            'title',
            'title-sm',
            'stat',
            'lead',
            'body-lg',
            'body',
            'body-sm',
            'label',
            'label-lg',
            'heading',
            'caption',
            'eyebrow',
            'data',
            'code',
            'display',
            'subheading',
            'prose',
            'screen-label',
            'figure-xl',
            'figure',
            'data-sm',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ownValue<V>(table: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOneOf<T extends string | number>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return allowed.some((item) => item === value);
}

export function emailInitials(email: string) {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

export function sentenceCaseStatus(status: string): string {
  const words = status.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
