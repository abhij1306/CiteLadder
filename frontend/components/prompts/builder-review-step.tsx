import type { ReactNode } from 'react';

import { StatusMark } from '@/components/ui/status-mark';
import { Button } from '@/components/ui/button';
import { FactList } from '@/components/ui/facts';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { PromptGenerateRequest } from '@citeladder/contracts/prompt-requests';
import type { PromptCandidate, Topic } from '@citeladder/contracts';
import { Sparkles } from '@/lib/icons';
import {
  moreForSegment,
  moreForTopic,
  segmentCoverage,
  topicCoverage,
  type CoverageRow,
  type PlannedCoverage,
} from '@/lib/prompts/builder-run';

const STATE: Record<
  PlannedCoverage,
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
      <StatusMark variant="status" value={STATE[row.state].badge}>
        {STATE[row.state].label}
      </StatusMark>
      <Button
        variant="quiet"
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

export function RunCoverage({
  request,
  topics,
  drafted,
  disabled,
  onGenerate,
}: Readonly<{
  request: PromptGenerateRequest;
  topics: readonly Topic[];
  drafted: readonly PromptCandidate[];
  disabled: boolean;
  onGenerate: (request: PromptGenerateRequest) => void;
}>) {
  const byTopic = topicCoverage(request, topics, drafted);
  const bySegment = segmentCoverage(request, drafted);
  const facts = <Row extends CoverageRow>(
    rows: readonly Row[],
    more: (row: Row) => PromptGenerateRequest,
  ) =>
    rows.map((row) => ({
      key: row.key,
      label: row.label,
      value: <CoverageValue row={row} disabled={disabled} onMore={() => onGenerate(more(row))} />,
    }));
  return (
    <Stack gap="workspace">
      <Stack gap="compact">
        <h3 className={textRole('subheading')}>Coverage by topic</h3>
        <FactList layout="spread" facts={facts(byTopic, (row) => moreForTopic(request, row))} />
      </Stack>
      <Stack gap="compact">
        <h3 className={textRole('subheading')}>Coverage by segment</h3>
        <FactList layout="spread" facts={facts(bySegment, (row) => moreForSegment(request, row))} />
      </Stack>
    </Stack>
  );
}

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
