import { Badge } from '@/components/ui/badge';
import { panelClasses } from '@/components/ui/panel';
import { Label, textRole } from '@/components/ui/typography';
import {
  recommendedActionLabel,
  sourceClassBadgeValue,
  sourceClassLabel,
  type SourcePattern,
} from '@/lib/opportunities/source-pattern';

/**
 * Observed source pattern for a visibility opportunity.
 *
 * Answers "what kinds of sources did the engines cite where you were not
 * cited" using the citations the audit already persisted. Every string here is
 * deliberately observational — "observed", "appears alongside" — because the
 * data supports no causal claim that a cited source produced the
 * recommendation. Do not reword this toward "because" or "caused by".
 */
export function OpportunitySourcePattern({ pattern }: Readonly<{ pattern: SourcePattern }>) {
  const action = recommendedActionLabel(pattern.recommendedAction);

  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Observed sources</Label>
        <span className="type-caption">
          {pattern.distinctDomainCount} {pattern.distinctDomainCount === 1 ? 'domain' : 'domains'}
          {pattern.independentDomainCount > 0
            ? ` · ${pattern.independentDomainCount} independent`
            : null}
        </span>
      </div>

      {pattern.classCounts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pattern.classCounts.map(({ sourceClass, count }) => (
            <Badge
              key={sourceClass}
              variant="classification"
              value={sourceClassBadgeValue(sourceClass)}
            >
              {sourceClassLabel(sourceClass)} · {count}
            </Badge>
          ))}
        </div>
      ) : null}

      {pattern.competitorSourceDomains.length > 0 ? (
        <div className="grid gap-1">
          <span className="type-caption">Sources matched to a tracked competitor</span>
          {pattern.competitorSourceDomains.map(({ competitor, domains }) => (
            <div key={competitor} className="flex items-start justify-between gap-3 py-0.5">
              <span className={textRole('body', 'shrink-0')}>{competitor}</span>
              <span className="type-caption text-right break-all tabular-nums">
                {domains.join(', ')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {pattern.topCitations.length > 0 ? (
        <ul className="grid gap-1">
          {pattern.topCitations.map((citation) => (
            <li
              key={citation.url || citation.domain}
              className={panelClasses({ tone: 'well' }, 'grid gap-0.5')}
            >
              <span className="type-caption text-foreground">
                {citation.title || citation.domain}
              </span>
              <span className="type-caption break-all tabular-nums">{citation.domain}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {pattern.topCitationsTruncated ? (
        <p className="type-caption">
          Showing the first {pattern.topCitations.length} of {pattern.distinctDomainCount} cited
          domains. Every citation stays available in Visibility → Sources.
        </p>
      ) : null}

      {action ? (
        <div className={panelClasses({ tone: 'accent' }, 'grid gap-1')}>
          <span className="type-caption">Suggested next action</span>
          <p className="type-body text-foreground">{action}</p>
        </div>
      ) : null}
    </section>
  );
}
