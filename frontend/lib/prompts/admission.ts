import type { PromptAdmissionDropReason } from '@citeladder/contracts/project';

/** Why suggested questions were not admitted, phrased for the person reviewing them. */
const DROP_REASON_COPY: Record<PromptAdmissionDropReason, string> = {
  unknown_topic: 'filed under a topic that no longer exists',
  unplanned_slot: 'not matched to a planned question',
  intent: 'with an unsupported intent',
  stage: 'with an unknown buying stage',
  duplicate: 'already tracked or suggested',
  length: 'too short or too long',
  placeholder: 'with an unfilled placeholder',
  observed_copy: 'copying an observed search query',
  off_topic: "unrelated to this project's brand, topics or profile",
  location_unplanned: 'naming a place the plan did not ask for',
  branded_core: 'naming your brand or a competitor',
  brand_missing: 'not naming your brand',
  competitor_missing: 'not comparing with a competitor',
};

/**
 * One sentence listing admission drops by reason, largest first, or '' when
 * nothing (else) was dropped. `exclude` omits reasons reported elsewhere.
 */
export function admissionDropSummary(
  drops: Partial<Record<PromptAdmissionDropReason, number>>,
  exclude: readonly PromptAdmissionDropReason[] = [],
): string {
  const parts = Object.entries(drops)
    .filter(
      (entry): entry is [PromptAdmissionDropReason, number] =>
        !exclude.includes(entry[0] as PromptAdmissionDropReason) && Number(entry[1]) > 0,
    )
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${count} ${DROP_REASON_COPY[reason] ?? 'failing checks'}`);
  return parts.length ? `Not admitted: ${parts.join('; ')}.` : '';
}
