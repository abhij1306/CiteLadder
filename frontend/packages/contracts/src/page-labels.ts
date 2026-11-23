import type { z } from 'zod';

import type { citationClassificationSchema } from './audits.ts';
import type { pageStandingSchema } from './visibility-evidence.ts';

export const URL_TYPES: readonly { token: string; label: string }[] = [
  { token: 'comparison', label: 'Comparison' },
  { token: 'alternative', label: 'Alternative' },
  { token: 'listicle', label: 'Listicle' },
  { token: 'review', label: 'Review' },
  { token: 'how_to', label: 'How-To Guide' },
  { token: 'article', label: 'Article' },
  { token: 'discussion', label: 'Discussion' },
  { token: 'profile', label: 'Profile' },
  { token: 'directory', label: 'Directory' },
  { token: 'product', label: 'Product Page' },
  { token: 'category', label: 'Category Page' },
  { token: 'homepage', label: 'Homepage' },
  { token: 'reference', label: 'Reference' },
  { token: 'video', label: 'Video' },
  { token: 'unresolved', label: 'Other' },
] as const;

const URL_TYPE_LABELS = new Map(URL_TYPES.map((type) => [type.token, type.label]));

export function urlTypeLabel(token: string | null | undefined): string | null {
  return (token && URL_TYPE_LABELS.get(token)) || null;
}

export type PageStanding = z.infer<typeof pageStandingSchema> | 'untracked';

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

export function classificationLabel(
  classification: z.infer<typeof citationClassificationSchema>,
): string {
  switch (classification) {
    case 'owned':
      return 'Owned';
    case 'unintended':
      return 'Owned (unintended)';
    case 'competitor':
      return 'Competitor';
    case 'third_party':
      return 'Third-party';
    default:
      return classification satisfies never;
  }
}
