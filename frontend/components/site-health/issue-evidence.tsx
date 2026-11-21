import type { IssueOccurrence } from '@citeladder/contracts';
import { textRole } from '@/components/ui/typography';
import { evidenceFacts, evidenceLead } from '@/lib/site-health/issue-evidence';

export function IssueEvidence({ occurrence }: Readonly<{ occurrence: IssueOccurrence }>) {
  const facts = evidenceFacts(occurrence.rule_id, occurrence.evidence, {
    pageUrl: occurrence.normalized_url,
  });
  if (facts.length === 0) return null;
  return <EvidenceLine lead={evidenceLead(occurrence.rule_id)} facts={facts} />;
}

export function EvidenceLine({
  lead,
  facts,
  text: role = 'caption',
}: Readonly<{ lead: string | null; facts: readonly string[]; text?: 'caption' | 'body' }>) {
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
