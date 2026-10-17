/**
 * In-progress review edits, kept for this browser tab so a reload does not
 * discard them.
 *
 * The URL already carries the discovery and step; this keeps what the reader
 * changed on the review step (websites, competitors and the business profile)
 * in `sessionStorage`, keyed by discovery. It is untrusted browser state: it is
 * parsed on read, dropped when it does not match, and completion still sends
 * everything to the server for validation.
 */
import { z } from 'zod';

import { brandDiscoverySchema } from '@citeladder/contracts/visibility';

import type { ReviewCompetitor, ReviewDomain } from './forms';

const STORAGE_PREFIX = 'citeladder.onboarding-review:';

const reviewDraftSchema = z.object({
  version: z.literal(1),
  domains: z.array(z.object({ id: z.string(), domain: z.string(), selected: z.boolean() })),
  competitors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      aliases: z.array(z.string()),
      domains: z.array(z.string()),
      selected: z.boolean(),
    }),
  ),
  profile: brandDiscoverySchema.shape.profile.nullable(),
});

export type ReviewDraft = {
  domains: ReviewDomain[];
  competitors: ReviewCompetitor[];
  profile: z.infer<typeof reviewDraftSchema>['profile'];
};

function storageKey(discoveryId: string) {
  return `${STORAGE_PREFIX}${discoveryId}`;
}

/** The saved edits for this discovery, or `null` when none are usable. */
export function readReviewDraft(discoveryId: string): ReviewDraft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(discoveryId));
    if (raw === null) return null;
    const parsed = reviewDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { domains, competitors, profile } = parsed.data;
    return { domains, competitors, profile };
  } catch {
    return null;
  }
}

export function saveReviewDraft(discoveryId: string, draft: ReviewDraft) {
  try {
    window.sessionStorage.setItem(
      storageKey(discoveryId),
      JSON.stringify({ version: 1, ...draft } satisfies z.input<typeof reviewDraftSchema>),
    );
  } catch {
    // Storage is a convenience: without it the edits last until a reload.
  }
}

export function clearReviewDraft(discoveryId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(discoveryId));
  } catch {
    // Nothing was saved.
  }
}
