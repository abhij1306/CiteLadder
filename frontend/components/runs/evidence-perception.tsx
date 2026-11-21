import type { ExecutionPerception } from '@citeladder/contracts/visibility-perception';

import { Absence } from '@/components/ui/absence';
import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { Inline, Stack } from '@/components/ui/layout';
import { Label, textRole } from '@/components/ui/typography';
import type { Highlight } from '@/lib/markdown/highlight';
import { wellClasses } from '@/components/ui/slip';

const SENTIMENT_LABELS = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  mixed: 'Mixed',
} as const;

export function perceptionHighlights(perception: readonly ExecutionPerception[]): Highlight[] {
  return perception.flatMap((entity) =>
    entity.state === 'classified'
      ? entity.aspects.map((aspect) => ({ text: aspect.quote, tone: aspect.polarity }))
      : [],
  );
}

const STATE_WORDS: Record<
  Exclude<ExecutionPerception['state'], 'classified' | 'unavailable'>,
  string
> = {
  not_assessable: 'Not assessable',
  low_confidence: 'Low confidence',
  pending: 'Classifying…',
};

function PerceptionChip({ entity }: Readonly<{ entity: ExecutionPerception }>) {
  const label = entity.label;
  if (entity.state === 'classified' && label && label !== 'not_assessable')
    return (
      <StatusMark variant="sentiment" value={label}>
        {SENTIMENT_LABELS[label]}
      </StatusMark>
    );
  if (entity.state === 'unavailable') return <Absence state="unavailable" />;
  return (
    <Tag>
      {entity.state === 'classified' ? STATE_WORDS.not_assessable : STATE_WORDS[entity.state]}
    </Tag>
  );
}

export function EvidencePerception({
  perception,
}: Readonly<{ perception: readonly ExecutionPerception[] }>) {
  if (!perception.length) return null;
  return (
    <Stack as="section" gap="item">
      <Label>Perception</Label>
      <Stack as="ul" gap="item">
        {perception.map((entity) => (
          <Stack as="li" gap="tight" key={entity.entity} className={wellClasses('min-w-0')}>
            <Inline as="span" className="flex-wrap">
              <span className={textRole('emphasis')}>{entity.entity}</span>
              {entity.is_brand ? (
                <span className={textRole('caption', 'text-ink-2')}>You</span>
              ) : null}
              <PerceptionChip entity={entity} />
            </Inline>
            {entity.state === 'classified'
              ? entity.aspects.map((aspect) => (
                  <span key={`${aspect.start}:${aspect.end}`} className="type-caption text-ink-2">
                    {aspect.theme} ({aspect.polarity}): “{aspect.quote}”
                  </span>
                ))
              : null}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
