import type { z } from 'zod';

import type { pageEntitySchema } from '@citeladder/contracts/source-pages';
import type { PageStanding } from '@citeladder/contracts/page-labels';

const PRESENCE_LABELS: Record<string, string> = {
  present: 'On the page',
  not_detected: 'Not found on the page',
  ambiguous: 'Match could not be confirmed',
  partial: 'Too little of the page was readable to judge it.',
  not_assessable: 'Name too short to judge on a page',
  not_inspected: 'Not inspected',
  blocked: 'Publisher blocks automated access',
  stale: 'From an earlier inspection',
};

export function presenceLabel(state: string): string | null {
  return PRESENCE_LABELS[state] ?? null;
}

const UNREAD_REASONS: Partial<Record<PageStanding, string>> = {
  blocked: 'Publisher blocks automated access',
  unreadable: 'Last read failed',
  not_read: 'Not read yet',
  not_assessable: 'Name too short to judge on a page',
};

export function unreadReason(standing: PageStanding): string | undefined {
  return UNREAD_REASONS[standing];
}

export type PageEntity = z.infer<typeof pageEntitySchema>;

export function pageRows(entities: readonly PageEntity[] | undefined, read: boolean) {
  const all = entities ?? [];
  const brand = read ? all.filter((entity) => entity.entity_kind === 'brand') : [];
  const competitors = all.filter(
    (entity) => entity.entity_kind !== 'brand' && entity.presence !== 'not_detected',
  );
  return [...brand, ...competitors];
}

const ENDS_CLEANLY = /[.!?…"”')\]]$/u;

export function readableQuote(passage: string): string {
  let text = passage.trim().replaceAll(/\s+/gu, ' ');
  if (/^\p{Ll}/u.test(text)) {
    const space = text.indexOf(' ');
    if (space > 0) text = `…${text.slice(space + 1)}`;
  }
  if (!ENDS_CLEANLY.test(text)) {
    const space = text.lastIndexOf(' ');
    if (space > 0) text = `${text.slice(0, space).replace(/[,;:]$/u, '')}…`;
  }
  return text;
}

export function quoteParts(text: string, name: string) {
  const at = name ? text.toLocaleLowerCase().indexOf(name.toLocaleLowerCase()) : -1;
  if (at < 0) return { before: text, match: '', after: '' };
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + name.length),
    after: text.slice(at + name.length),
  };
}
