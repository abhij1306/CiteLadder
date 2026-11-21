import { parseContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';

export const contentGapEvidence = (row: { rule_id: string; evidence: unknown }) =>
  parseContentGapEvidence(row.rule_id, row.evidence)?.evidence ?? null;
