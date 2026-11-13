/**
 * What the Action page says about content gaps (content optimization section
 * 2): each live content-gap finding's persisted evidence, in full.
 */
import { parseContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';

/** A finding's stored content-gap evidence, for the Action page; null for any other finding. */
export const contentGapEvidence = (row: { rule_id: string; evidence: unknown }) =>
  parseContentGapEvidence(row.rule_id, row.evidence)?.evidence ?? null;
