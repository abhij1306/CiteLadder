import type { IssueOccurrence } from '@citeladder/contracts';
import { textRole } from '@/components/ui/typography';
import { evidenceFacts, evidenceLead } from '@/lib/site-health/issue-evidence';

/**
 * What was missing, on one line, in the notation of the fix.
 *
 * There is no "Observed evidence" label. The heading cost a line and a
 * hierarchy level to announce a section the reader was already looking at,
 * and the sentences under it restated the issue title. What earns its place
 * is the part the title cannot carry: WHICH property, WHICH control, WHICH
 * heading jump — `og:title, og:description`, not "Has og title: false."
 *
 * The one exception is a rule whose facts are not about the page's own
 * markup — links found on it, pages found elsewhere. Those get a short lead
 * ("Links on this page that redirect:") and one fact per line, because a bare
 * `old → new` under a page's name reads as the page itself redirecting.
 */
export function IssueEvidence({ occurrence }: Readonly<{ occurrence: IssueOccurrence }>) {
  const facts = evidenceFacts(occurrence.rule_id, occurrence.evidence, {
    pageUrl: occurrence.normalized_url,
  });
  // Nothing at all, rather than "no evidence recorded": the title and the
  // remediation already stand on their own, and an empty-state sentence in a
  // two-hundred-row catalog is two hundred lines of apology.
  if (facts.length === 0) return null;
  return <EvidenceLine lead={evidenceLead(occurrence.rule_id)} facts={facts} />;
}

/**
 * The evidence line itself, for one page's occurrence or for evidence shown
 * once over the pages that share it. `text` lets a shared line stand as the
 * header of the pages under it.
 */
export function EvidenceLine({
  lead,
  facts,
  text: role = 'caption',
}: Readonly<{ lead: string | null; facts: readonly string[]; text?: 'caption' | 'itemTitle' }>) {
  if (!lead)
    return (
      <p className={textRole(role, '[overflow-wrap:anywhere]')}>
        <code>{facts.join(', ')}</code>
      </p>
    );
  return (
    <div className={textRole(role, 'min-w-0 [overflow-wrap:anywhere]')}>
      <span>{lead}</span>
      <ul>
        {facts.map((fact) => (
          <li key={fact}>
            <code>{fact}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
