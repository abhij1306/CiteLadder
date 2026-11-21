import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

import { CompetitorThemes } from '@/components/perception/competitor-themes';
import { PerceptionBreakdown } from '@/components/perception/perception-breakdown';
import { AppGrid } from '@/components/ui/app-grid';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { Stack } from '@/components/ui/layout';
import { Meter } from '@/components/ui/meter';
import { PartDonut } from '@/components/ui/part-donut';
import { Section, SectionContent, SectionStack, TitledSection } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { SegmentedControl } from '@/components/ui/tabs';
import { AreaChart } from '@/components/ui/area-chart';
import { textRole } from '@/components/ui/typography';
import {
  EntityTable,
  NegativeQuotes,
  PerceptionState,
} from '@/components/visibility/visibility-perception';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate } from '@/lib/format';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import {
  coverageExtras,
  formatNet,
  gatedFigure,
  negativeHeadline,
  shareReading,
  rankThemes,
  sentimentTrend,
} from '@/lib/visibility/perception';

const THEME_LIST_LIMIT = 8;

export function PerceptionView({
  data,
  factFigure,
}: Readonly<{ data: PerceptionResponse; factFigure?: FigureSegment }>) {
  if (data.state !== 'value')
    return <PerceptionState state={data.state} reason={data.reason} coverage={data.coverage} />;
  return (
    <SectionStack>
      <Lede data={data} factFigure={factFigure} />
      <AppGrid layout="main-aside">
        <ThemeList themes={data.themes} />
        <SentimentRing data={data} />
      </AppGrid>
      <SentimentTrend trend={data.trend} />
      <AppGrid layout="halves">
        <EntityTable entities={data.entities} />
        <NegativeQuotes quotes={data.negative_quotes} />
      </AppGrid>
      <PerceptionBreakdown data={data} />
      {data.entities.some((entity) => !entity.is_brand) ? (
        <CompetitorThemes entities={data.entities} />
      ) : null}
    </SectionStack>
  );
}

function Lede({
  data,
  factFigure,
}: Readonly<{ data: PerceptionResponse; factFigure?: FigureSegment }>) {
  const score = data.brand?.score;
  const { recommended, coverage } = data;
  const share = (key: 'positive' | 'negative', label: string): FigureSegment =>
    score
      ? {
          key,
          label,
          ...gatedFigure(shareReading(score[`${key}_share`], score.classified)),
          sub: `${score[key]} of ${score.classified} classified mentions`,
        }
      : { key, label, value: null, missingState: 'unavailable' };
  const segments: FigureSegment[] = [
    {
      key: 'describing',
      label: 'Describing you',
      value: `${coverage.classified} / ${coverage.mentions}`,
      sub: coverageExtras(coverage).join(' · ') || undefined,
    },
    share('positive', 'Positive'),
    share('negative', 'Negative'),
    {
      key: 'recommended',
      label: 'Recommended',
      ...gatedFigure(shareReading(recommended.rate, recommended.mentioned), 'answers'),
      sub:
        `${recommended.recommended} of ${recommended.mentioned} answers naming you` +
        (recommended.recommended_against
          ? `; ${recommended.recommended_against} advised against`
          : ''),
    },
  ];
  return (
    <Section>
      <SectionContent>
        <Stack gap="item">
          <h2 className={textRole('heading')}>
            {negativeHeadline(score) ?? 'How AI describes you'}
          </h2>
          <FigureStrip
            label="Brand perception"
            segments={factFigure ? [...segments, factFigure] : segments}
          />
        </Stack>
      </SectionContent>
    </Section>
  );
}

type ThemeOrder = 'negative' | 'positive';

const ORDER_CODEC = stringUrlCodec<ThemeOrder>(['negative', 'positive'], 'negative');

function ThemeList({ themes }: Readonly<{ themes: PerceptionResponse['themes'] }>) {
  const [order, setOrder] = useUrlState('theme_order', ORDER_CODEC, { history: 'replace' });
  const ranked = rankThemes(themes, order, THEME_LIST_LIMIT);
  const most = ranked[0]?.[order] ?? 0;
  return (
    <TitledSection
      title="Themes in answers"
      actions={
        <SegmentedControl
          value={order}
          onChange={setOrder}
          ariaLabel="Order themes"
          options={[
            { value: 'negative', label: 'Most negative' },
            { value: 'positive', label: 'Most positive' },
          ]}
        />
      }
    >
      <SectionContent>
        {ranked.length ? (
          <Stack as="ul">
            {ranked.map((theme) => (
              <li key={theme.theme}>
                <Meter
                  label={theme.theme}
                  value={(theme[order] / most) * 100}
                  valueLabel={`${theme[order]} ${order}`}
                  tone={order === 'negative' ? 'negative' : 'accent'}
                />
              </li>
            ))}
          </Stack>
        ) : (
          <StateBlock kind="empty" inline message={`No ${order} themes in these answers.`} />
        )}
      </SectionContent>
    </TitledSection>
  );
}

function SentimentRing({ data }: Readonly<{ data: PerceptionResponse }>) {
  return (
    <TitledSection title="How AI judges you">
      <SectionContent>
        <SentimentParts score={data.brand?.score} />
      </SectionContent>
    </TitledSection>
  );
}

function SentimentParts({
  score,
}: Readonly<{ score: PerceptionResponse['entities'][number]['score'] | undefined }>) {
  if (!score?.classified)
    return <StateBlock kind="empty" inline message="No classified mentions of you." />;
  const reading = shareReading(score.positive_share, score.classified);
  if (reading.kind === 'too_few')
    return (
      <StateBlock
        kind="empty"
        inline
        message={`Too few classified (${reading.basis} of the ${reading.minimum} needed).`}
      />
    );
  return (
    <PartDonut
      label="Sentiment of classified mentions"
      totalLabel="classified"
      total={score.classified}
      parts={[
        { label: 'Positive', value: score.positive, status: 'positive' },
        { label: 'Neutral', value: score.neutral, status: 'neutral' },
        { label: 'Negative', value: score.negative, status: 'negative' },
        { label: 'Mixed', value: score.mixed, status: 'warning' },
      ]}
    />
  );
}

function SentimentTrend({ trend }: Readonly<{ trend: PerceptionResponse['trend'] }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <TitledSection title="Net sentiment over time">
      <SectionContent>
        {trend.length > 1 ? (
          <AreaChart
            label="Net sentiment over time"
            data={sentimentTrend(trend, (iso) => formatDisplayDate(iso, timeZone))}
            yMin={-100}
            yMax={100}
            yFormat={(value) => formatNet(value) ?? ''}
          />
        ) : (
          <StateBlock kind="empty" inline message="Only one run in this period." />
        )}
      </SectionContent>
    </TitledSection>
  );
}
