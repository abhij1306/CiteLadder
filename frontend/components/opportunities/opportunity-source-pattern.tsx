import { Badge } from '@/components/ui/badge';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Label, textRole } from '@/components/ui/typography';
import type { SourcePattern } from '@citeladder/contracts';
import {
  classCountChips,
  recommendedActionLabel,
  sourceClassBadgeValue,
  sourceClassLabel,
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
  const action = recommendedActionLabel(pattern.recommended_action);
  const classCounts = classCountChips(pattern);
  const competitorSourceDomains = Object.entries(pattern.competitor_source_domains);

  return (
    <Stack as="section">
      <Inline gap="compact" className="items-baseline justify-between">
        <Label>Observed sources</Label>
        <span className="type-caption">
          {pattern.distinct_domain_count}{' '}
          {pattern.distinct_domain_count === 1 ? 'domain' : 'domains'}
          {pattern.independent_domain_count > 0
            ? ` · ${pattern.independent_domain_count} independent`
            : null}
        </span>
      </Inline>

      {classCounts.length > 0 ? (
        <Inline className="flex-wrap">
          {classCounts.map(({ sourceClass, count }) => (
            <Badge
              key={sourceClass}
              variant="classification"
              value={sourceClassBadgeValue(sourceClass)}
            >
              {sourceClassLabel(sourceClass)} · {count}
            </Badge>
          ))}
        </Inline>
      ) : null}

      {competitorSourceDomains.length > 0 ? (
        <Stack gap="tight">
          <span className="type-caption">Sources matched to a tracked competitor</span>
          {competitorSourceDomains.map(([competitor, domains]) => (
            <Inline key={competitor} gap="compact" className="items-start justify-between">
              <span className={textRole('body', 'shrink-0')}>{competitor}</span>
              <span className="type-caption text-right break-all tabular-nums">
                {domains.join(', ')}
              </span>
            </Inline>
          ))}
        </Stack>
      ) : null}

      {pattern.top_citations.length > 0 ? (
        <Stack as="ul" gap="tight">
          {pattern.top_citations.map((citation) => (
            <Stack
              as="li"
              gap="tight"
              key={citation.url || citation.domain}
              className={panelClasses({ tone: 'well' })}
            >
              <span className="type-caption text-ink">{citation.title || citation.domain}</span>
              <span className="type-caption break-all tabular-nums">{citation.domain}</span>
            </Stack>
          ))}
        </Stack>
      ) : null}

      {pattern.top_citations_truncated ? (
        <p className="type-caption">
          Showing the first {pattern.top_citations.length} of {pattern.distinct_domain_count} cited
          domains. Every citation stays available in Visibility → Sources.
        </p>
      ) : null}

      {action ? (
        <Stack gap="tight" className={panelClasses({ tone: 'well' })}>
          <span className="type-caption">Suggested next action</span>
          <p className="type-body text-ink">{action}</p>
        </Stack>
      ) : null}
    </Stack>
  );
}
