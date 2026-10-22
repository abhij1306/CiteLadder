import { Badge } from '@/components/ui/badge';
import { Inline, Stack } from '@/components/ui/layout';
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
    <Stack as="section">
      <Inline gap="compact" className="items-baseline justify-between">
        <Label>Observed sources</Label>
        <span className="type-caption">
          {pattern.distinctDomainCount} {pattern.distinctDomainCount === 1 ? 'domain' : 'domains'}
          {pattern.independentDomainCount > 0
            ? ` · ${pattern.independentDomainCount} independent`
            : null}
        </span>
      </Inline>

      {pattern.classCounts.length > 0 ? (
        <Inline className="flex-wrap">
          {pattern.classCounts.map(({ sourceClass, count }) => (
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

      {pattern.competitorSourceDomains.length > 0 ? (
        <Stack gap="tight">
          <span className="type-caption">Sources matched to a tracked competitor</span>
          {pattern.competitorSourceDomains.map(({ competitor, domains }) => (
            <Inline key={competitor} gap="compact" className="items-start justify-between">
              <span className={textRole('body', 'shrink-0')}>{competitor}</span>
              <span className="type-caption text-right break-all tabular-nums">
                {domains.join(', ')}
              </span>
            </Inline>
          ))}
        </Stack>
      ) : null}

      {pattern.topCitations.length > 0 ? (
        <Stack as="ul" gap="tight">
          {pattern.topCitations.map((citation) => (
            <Stack
              as="li"
              gap="tight"
              key={citation.url || citation.domain}
              className={panelClasses({ tone: 'well' })}
            >
              <span className="type-caption text-foreground">
                {citation.title || citation.domain}
              </span>
              <span className="type-caption break-all tabular-nums">{citation.domain}</span>
            </Stack>
          ))}
        </Stack>
      ) : null}

      {pattern.topCitationsTruncated ? (
        <p className="type-caption">
          Showing the first {pattern.topCitations.length} of {pattern.distinctDomainCount} cited
          domains. Every citation stays available in Visibility → Sources.
        </p>
      ) : null}

      {action ? (
        <Stack gap="tight" className={panelClasses({ tone: 'accent' })}>
          <span className="type-caption">Suggested next action</span>
          <p className="type-body text-foreground">{action}</p>
        </Stack>
      ) : null}
    </Stack>
  );
}
