'use client';

import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FactList } from '@/components/ui/facts';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { PromptGenerateInput } from '@/lib/api/prompts';
import type { PromptCandidate, Topic } from '@/lib/api/types';
import {
  moreForSegment,
  moreForTopic,
  segmentCoverage,
  topicCoverage,
  type CoverageRow,
  type CoverageState,
} from '@/lib/prompts/builder-run';

const STATE: Record<
  CoverageState,
  { label: string; badge: 'success' | 'warning' | 'danger' | 'info' }
> = {
  on_target: { label: 'On target', badge: 'success' },
  short: { label: 'Short', badge: 'warning' },
  empty: { label: 'Empty', badge: 'danger' },
  not_planned: { label: 'Not planned', badge: 'info' },
};

function CoverageValue({
  row,
  disabled,
  onMore,
}: Readonly<{ row: CoverageRow; disabled: boolean; onMore: () => void }>) {
  const short = row.state === 'short' || row.state === 'empty';
  return (
    <Inline>
      <span className="tabular-nums">
        {row.actual} of {row.target}
      </span>
      <Badge variant="status" value={STATE[row.state].badge}>
        {STATE[row.state].label}
      </Badge>
      <Button
        variant="ghost"
        onClick={onMore}
        disabled={disabled || !short}
        aria-label={`Generate more for ${row.label}`}
      >
        <Icon icon={Sparkles} />
        More
      </Button>
    </Inline>
  );
}

/**
 * Coverage of the builder's run against what it asked for: drafted
 * suggestions per topic and per segment, each on target, short or empty,
 * with "Generate more" for that one topic or segment.
 */
export function RunCoverage({
  request,
  topics,
  drafted,
  disabled,
  onGenerate,
}: Readonly<{
  request: PromptGenerateInput;
  topics: readonly Topic[];
  /** Every suggestion this builder session drafted, reviewed or not. */
  drafted: readonly PromptCandidate[];
  disabled: boolean;
  onGenerate: (request: PromptGenerateInput) => void;
}>) {
  const byTopic = topicCoverage(request, topics, drafted);
  const bySegment = segmentCoverage(request, drafted);
  const facts = <Row extends CoverageRow>(
    rows: readonly Row[],
    more: (row: Row) => PromptGenerateInput,
  ) =>
    rows.map((row) => ({
      key: row.key,
      label: row.label,
      value: <CoverageValue row={row} disabled={disabled} onMore={() => onGenerate(more(row))} />,
    }));
  return (
    <Stack gap="workspace">
      <Stack gap="compact">
        <h3 className={textRole('itemTitle')}>Coverage by topic</h3>
        <FactList layout="spread" facts={facts(byTopic, (row) => moreForTopic(request, row))} />
      </Stack>
      <Stack gap="compact">
        <h3 className={textRole('itemTitle')}>Coverage by segment</h3>
        <FactList layout="spread" facts={facts(bySegment, (row) => moreForSegment(request, row))} />
      </Stack>
    </Stack>
  );
}

/** Step 4: the run's outcome, its coverage when the builder made it, then the review list. */
export function BuilderReviewStep({
  notices,
  coverage,
  review,
}: Readonly<{ notices: ReactNode; coverage: ReactNode; review: ReactNode }>) {
  return (
    <Stack gap="section">
      {notices}
      {coverage}
      {review}
    </Stack>
  );
}
