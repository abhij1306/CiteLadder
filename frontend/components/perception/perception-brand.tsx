import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

import { AttributeRanks } from '@/components/perception/attribute-ranks';
import { PerceptionBreakdown } from '@/components/perception/perception-breakdown';
import { AppGrid } from '@/components/ui/app-grid';
import { AreaChart } from '@/components/ui/area-chart';
import { Card, CardHeader } from '@/components/ui/card';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { Notice } from '@/components/ui/notice';
import { PartDonut, type Part } from '@/components/ui/part-donut';
import { SectionStack } from '@/components/ui/section';
import { Tag } from '@/components/ui/tag';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { PerceptionState } from '@/components/visibility/visibility-perception';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { availabilityLabel, formatDisplayDate } from '@/lib/format';
import { BRAND_PROMPTS_HREF } from '@/lib/prompts/routes';
import {
  coverageExtras,
  describesTooFew,
  formatNet,
  sampleNote,
  sampleShare,
  sentimentTrend,
  SMALL_SAMPLE,
} from '@/lib/visibility/perception';

type Score = PerceptionResponse['entities'][number]['score'];

export function PerceptionView({
  data,
  factFigure,
}: Readonly<{ data: PerceptionResponse; factFigure?: FigureSegment }>) {
  const nudge = describesTooFew(data) ? <BrandPromptsNudge /> : null;
  if (data.state !== 'value')
    return (
      <SectionStack>
        {nudge}
        <PerceptionState state={data.state} reason={data.reason} coverage={data.coverage} />
      </SectionStack>
    );
  const categories = data.brand?.categories ?? [];
  const score = data.brand?.score;
  const ranks = categories.some((category) => category.negative > 0 || category.positive > 0) ? (
    <AttributeRanks categories={categories} />
  ) : null;
  const ring = score?.classified ? <SentimentCard score={score} /> : null;
  return (
    <SectionStack>
      {nudge}
      <FigureStrip
        label="Brand perception"
        segments={[...headlineFigures(data), ...(factFigure ? [factFigure] : [])]}
      />
      {ranks && ring ? (
        <AppGrid layout="main-aside">
          {ranks}
          {ring}
        </AppGrid>
      ) : (
        (ranks ?? ring)
      )}
      {data.trend.length > 1 ? <SentimentTrend trend={data.trend} /> : null}
      <PerceptionBreakdown data={data} categories={categories} />
    </SectionStack>
  );
}

function BrandPromptsNudge() {
  return (
    <Notice tone="info">
      Few answers describe you: <TextLink href={BRAND_PROMPTS_HREF}>add brand prompts</TextLink>
    </Notice>
  );
}

function headlineFigures(data: PerceptionResponse): FigureSegment[] {
  const score = data.brand?.score;
  const { coverage } = data;
  return [
    {
      key: 'describing',
      label: 'Describing you',
      value: `${coverage.classified} / ${coverage.mentions}`,
      sub: coverageExtras(coverage).join(' · ') || undefined,
    },
    shareFigure({ key: 'positive', label: 'Positive answers', score }),
    shareFigure({ key: 'negative', label: 'Negative answers', score }),
  ];
}

function shareFigure({
  key,
  label,
  score,
}: Readonly<{
  key: 'positive' | 'negative';
  label: string;
  score: Score | undefined;
}>): FigureSegment {
  if (!score) return { key, label, value: null, missingState: 'unavailable' };
  const reading = sampleShare({ count: score[key], basis: score.classified });
  if (reading.kind === 'empty')
    return { key, label, value: null, missingLabel: `${availabilityLabel('too_few')} classified` };
  return {
    key,
    label,
    value: reading.text,
    marker: reading.small ? <Tag>{SMALL_SAMPLE}</Tag> : undefined,
    sub: sampleNote(reading, 'classified mentions'),
  };
}

function SentimentCard({ score }: Readonly<{ score: Score }>) {
  const parts = (
    [
      { label: 'Negative', value: score.negative, status: 'negative' },
      { label: 'Mixed', value: score.mixed, status: 'warning' },
      { label: 'Positive', value: score.positive, status: 'positive' },
      { label: 'Neutral', value: score.neutral, status: 'neutral' },
    ] satisfies Part[]
  ).filter((part) => part.value > 0);
  return (
    <Card aria-label="Sentiment" className="flex min-w-0 flex-col">
      <CardHeader>
        <h3 className={textRole('subheading')}>Sentiment</h3>
      </CardHeader>
      <div className="flex flex-1 items-center justify-center">
        <PartDonut
          layout="stacked"
          label="Sentiment of classified mentions"
          totalLabel="mentions"
          total={score.classified}
          parts={parts}
        />
      </div>
    </Card>
  );
}

function SentimentTrend({ trend }: Readonly<{ trend: PerceptionResponse['trend'] }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <Card aria-label="Net sentiment">
      <CardHeader>
        <h3 className={textRole('subheading')}>Net sentiment</h3>
      </CardHeader>
      <AreaChart
        label="Net sentiment over time"
        name="Net sentiment"
        empty="Too few classified mentions to score"
        data={sentimentTrend(trend, (iso) => formatDisplayDate(iso, timeZone))}
        yMin={-100}
        yMax={100}
        yFormat={(value) => formatNet(value) ?? ''}
      />
    </Card>
  );
}
