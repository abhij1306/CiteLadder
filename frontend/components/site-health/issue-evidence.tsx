import type { IssueOccurrence } from '@/lib/api/types';
import { evidenceFacts } from '@/lib/site-health/issue-evidence';

/**
 * What was missing, on one line, in the notation of the fix.
 *
 * There is no "Observed evidence" label. The heading cost a line and a
 * hierarchy level to announce a section the reader was already looking at,
 * and the sentences under it restated the issue title. What earns its place
 * is the part the title cannot carry: WHICH property, WHICH control, WHICH
 * heading jump — `og:title, og:description`, not "Has og title: false."
 */
export function IssueEvidence({ occurrence }: Readonly<{ occurrence: IssueOccurrence }>) {
  const facts = evidenceFacts(occurrence.rule_id, occurrence.evidence);
  // Nothing at all, rather than "no evidence recorded": the title and the
  // remediation already stand on their own, and an empty-state sentence in a
  // two-hundred-row catalog is two hundred lines of apology.
  if (facts.length === 0) return null;
  return (
    <p className="type-caption [overflow-wrap:anywhere]">
      <code>{facts.join(', ')}</code>
    </p>
  );
}
