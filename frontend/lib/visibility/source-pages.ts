import type { z } from 'zod';

import type { pageEntitySchema } from '@citeladder/contracts/source-pages';
import type { pageStandingSchema } from '@citeladder/contracts/visibility-evidence';
import { formatCount } from '@/lib/format';
import { sinceLabel } from '@/lib/visibility/sources';

const COVERAGE_TOO_THIN = 'Too little of the page was readable to judge it.';

const PRESENCE_LABELS: Record<string, string> = {
  present: 'On the page',
  not_detected: 'Not found on the page',
  ambiguous: 'Match could not be confirmed',
  partial: COVERAGE_TOO_THIN,
  not_assessable: 'Name too short to judge on a page',
  not_inspected: 'Not inspected',
  blocked: 'Publisher blocks automated access',
  stale: 'From an earlier inspection',
};

const MATCH_METHOD_LABELS: Record<string, string> = {
  exact_alias: 'the exact name',
  normalized_alias: 'a normalized form of the name',
};

export function presenceLabel(state: string): string | null {
  return PRESENCE_LABELS[state] ?? null;
}

const UNKNOWN_METHOD_BASIS: Record<string, string> = {
  not_detected: 'no form of the name matched',
  ambiguous: 'a match was found that could not be quoted',
  partial: 'not enough of it to settle this',
};

export function absenceBasis(
  state: string,
  matchMethod: string | null,
  extractedChars: number | null,
): string | null {
  const fallback = UNKNOWN_METHOD_BASIS[state];
  if (!fallback) return null;
  if (extractedChars === null || extractedChars <= 0) return null;
  const read = `${formatCount(extractedChars)} characters of readable text`;
  const method = matchMethod ? MATCH_METHOD_LABELS[matchMethod] : undefined;
  return method ? `Searched ${read} for ${method}.` : `Searched ${read}; ${fallback}.`;
}

export type PageStanding = z.infer<typeof pageStandingSchema> | 'untracked';

const UNREAD_REASONS: Partial<Record<PageStanding, string>> = {
  blocked: 'Publisher blocks automated access',
  unreadable: 'Last read failed',
  not_read: 'Not read yet',
  not_assessable: 'Name too short to judge on a page',
};

export function unreadReason(standing: PageStanding): string | undefined {
  return UNREAD_REASONS[standing];
}

const STANDING_LABELS: Record<PageStanding, string> = {
  untracked: 'Not tracked',
  yours: 'Your page',
  competitor: "Competitor's page",
  blocked: 'Blocked',
  unreadable: 'Read failed',
  not_read: 'Not read',
  gap: 'Gap',
  listed: 'Listed',
  read: 'Read',
  not_assessable: 'Not assessable',
};

export function standingLabel(standing: PageStanding | null): string {
  return STANDING_LABELS[standing ?? 'untracked'];
}

export type PageEntity = z.infer<typeof pageEntitySchema>;

export function onPageCompetitors(entities: readonly PageEntity[] | undefined) {
  return (entities ?? []).filter(
    (entity) => entity.entity_kind !== 'brand' && entity.presence === 'present',
  );
}

export function brandVerdict(entities: readonly PageEntity[] | undefined): PageEntity | null {
  return (entities ?? []).find((entity) => entity.entity_kind === 'brand') ?? null;
}

export function readingSentence(
  readAt: string | null | undefined,
  extractedChars: number | null | undefined,
): string | null {
  if (!extractedChars) return null;
  const read = sinceLabel(readAt);
  const chars = `${formatCount(extractedChars)} characters were readable.`;
  return read ? `Read ${read.toLowerCase()}; ${chars}` : chars;
}
