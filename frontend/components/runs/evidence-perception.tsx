'use client';

import type { ExecutionPerception } from '@citeladder/contracts/visibility-perception';

import { Badge } from '@/components/ui/badge';
import { panelClasses } from '@/components/ui/panel';
import { Label, textRole } from '@/components/ui/typography';
import type { Highlight } from '@/lib/markdown/highlight';
import { themeLabel } from '@/lib/visibility/perception';

const SENTIMENT_LABELS = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  mixed: 'Mixed',
} as const;

/** The verified quotes, to mark in the rendered answer. */
export function perceptionHighlights(perception: readonly ExecutionPerception[]): Highlight[] {
  return perception.flatMap((entity) =>
    entity.state === 'classified'
      ? entity.aspects.map((aspect) => ({ text: aspect.quote, tone: aspect.polarity }))
      : [],
  );
}

const STATE_WORDS: Record<Exclude<ExecutionPerception['state'], 'classified'>, string> = {
  not_assessable: 'Not assessable',
  low_confidence: 'Low confidence',
  pending: 'Classifying…',
  unavailable: 'Unavailable',
};

function PerceptionChip({ entity }: Readonly<{ entity: ExecutionPerception }>) {
  const label = entity.label;
  if (entity.state === 'classified' && label && label !== 'not_assessable')
    return (
      <Badge variant="sentiment" value={label}>
        {SENTIMENT_LABELS[label]}
      </Badge>
    );
  return (
    <Badge>
      {entity.state === 'classified' ? STATE_WORDS.not_assessable : STATE_WORDS[entity.state]}
    </Badge>
  );
}

/** How this answer portrayed each business it named, with the quotes behind it. */
export function EvidencePerception({
  perception,
}: Readonly<{ perception: readonly ExecutionPerception[] }>) {
  if (!perception.length) return null;
  return (
    <section className="grid gap-2">
      <Label>Perception</Label>
      <ul className="grid gap-2">
        {perception.map((entity) => (
          <li
            key={entity.entity}
            className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid min-w-0 gap-1')}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className={textRole('emphasis')}>{entity.entity}</span>
              {entity.is_brand ? (
                <span className={textRole('caption', 'text-muted')}>You</span>
              ) : null}
              <PerceptionChip entity={entity} />
            </span>
            {entity.state === 'classified'
              ? entity.aspects.map((aspect) => (
                  <span
                    key={`${aspect.start}:${aspect.end}`}
                    className="type-caption text-secondary"
                  >
                    {themeLabel(aspect.theme)} ({aspect.polarity}): “{aspect.quote}”
                  </span>
                ))
              : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
