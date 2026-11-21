import type { UseQueryResult } from '@tanstack/react-query';

import type { Visibility } from '@citeladder/contracts';
import type { VisibilityMatrix } from '@citeladder/contracts/visibility-matrix';
import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { GridTableSkeleton, RankLegend, RankTable } from '@/components/ui/heat-table';
import { Stack } from '@/components/ui/layout';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { MATRIX_DIMENSIONS, RANKING_DIMENSIONS } from '@/lib/config/visibility';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { formatRate } from '@/lib/visibility/dashboard';
import { READING_LABELS } from '@/lib/visibility/matrix';
import { AxisLabel, matrixBodyState, pendingAxisLength, useAxisText } from './matrix-parts';

const PLACES = 5;

const byCodec = stringUrlCodec(
  RANKING_DIMENSIONS.map((option) => option.value),
  'topic',
);

export function TopRankings({
  query,
  selected,
}: Readonly<{ query: UseQueryResult<VisibilityMatrix>; selected: Visibility }>) {
  const [by, setBy] = useUrlState('rankings_by', byCodec);
  const axisText = useAxisText();
  const data = query.data;
  const segments = data ? axisText(data.axes, by) : [];
  const rows = data
    ? segments.map((text, i) => {
        const ranking = data.rankings[by][i];
        return {
          key: `${by}-${i}`,
          header: <AxisLabel axes={data.axes} dimension={by} index={i} text={text} />,
          chips: (ranking?.kind === 'measured' ? ranking.leaders : []).map((leader) => ({
            key: `${leader.is_brand}:${leader.name}`,
            mark: (
              <BrandMark
                name={leader.name}
                logoUrl={leader.logo_url}
                websiteUrl={leader.website_url}
                placement="inline"
              />
            ),
            name: leader.name,
            detail: formatRate(leader.mention_rate),
            own: leader.is_brand,
          })),
          empty: <Absence state="not_run" label={READING_LABELS.not_run} />,
        };
      })
    : [];
  function body() {
    if (!data) return null;
    return (
      <RankTable
        labelledBy="insights-rankings"
        corner={MATRIX_DIMENSIONS.find((option) => option.value === by)?.label ?? by}
        places={PLACES}
        rows={rows}
      />
    );
  }
  return (
    <Section aria-labelledby="insights-rankings">
      <SectionHeader
        actions={
          <Select
            ariaLabel="Rank by"
            value={by}
            options={RANKING_DIMENSIONS}
            onValueChange={setBy}
          />
        }
      >
        <SectionTitle id="insights-rankings">Top rankings</SectionTitle>
      </SectionHeader>
      <Stack>
        {matrixBodyState(
          query,
          'rankings',
          <GridTableSkeleton
            label="Loading the rankings…"
            variant="rank"
            rows={pendingAxisLength(selected, by)}
            columns={PLACES}
          />,
        ) ?? body()}
        <RankLegend />
      </Stack>
    </Section>
  );
}
