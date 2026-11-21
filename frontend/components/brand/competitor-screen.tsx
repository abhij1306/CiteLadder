import type { RankingRow, Visibility } from '@citeladder/contracts';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { CompetitorSources, NamedInsteadOfYou } from '@/components/brand/competitor-focus-cards';
import { CompetitorTrend } from '@/components/brand/competitor-trend';
import { RecordPage } from '@/components/templates/record-page';
import { Absence } from '@/components/ui/absence';
import { AppGrid } from '@/components/ui/app-grid';
import { Button } from '@/components/ui/button';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { ProjectLink } from '@/components/ui/project-link';
import { SectionStack } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { RankedBrandMark } from '@/components/visibility/ranked-brand-mark';
import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { AnalysisRead, SelectionGate } from '@/components/visibility/selection-gate';
import {
  SelectionPageStateBlock,
  selectionPageFilterBar,
  selectionPageState,
  useSelectionPageFilters,
} from '@/components/visibility/selection-page';
import { ApiError } from '@/lib/api/errors';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { formatPositionExact, formatRate } from '@/lib/visibility/dashboard';
import { absent, type Formatted, isAbsent } from '@/lib/format';
import { sentimentFigureValue } from '@/lib/visibility/perception';
import { winRateAbsence } from '@/lib/visibility/ranking';
import { selectionEnabled, topicSelectionParams } from '@/lib/visibility/use-source-analysis';
import {
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

type Filters = ReturnType<typeof useVisibilityFilters>;
type Queries = ReturnType<typeof useVisibilityQueries>;

const isUnknownCompetitor = (error: unknown) =>
  error instanceof ApiError && error.code === 'competitor_not_found';

export function CompetitorScreen() {
  const { name = '' } = useParams();
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(filters, 'competitor');
  const state = selectionPageState(queries);
  const pageFilters = useSelectionPageFilters({ view: 'competitor', filters, queries });
  return (
    <RecordPage
      title={name}
      crumb={{
        label: name,
        mark: <RankedBrandMark name={name} rows={queries.visibilityQuery.data?.rankings} />,
      }}
      filters={selectionPageFilterBar(state, pageFilters)}
    >
      {queries.activeRun && state !== 'empty' ? <ActiveRunBanner run={queries.activeRun} /> : null}
      {state ? (
        <SelectionPageStateBlock state={state} queries={queries} />
      ) : (
        <SelectionGate query={queries.visibilityQuery}>
          {(selected) => (
            <CompetitorBody name={name} selected={selected} filters={filters} queries={queries} />
          )}
        </SelectionGate>
      )}
    </RecordPage>
  );
}

function CompetitorBody({
  name,
  selected,
  filters,
  queries,
}: Readonly<{ name: string; selected: Visibility; filters: Filters; queries: Queries }>) {
  const enabled = selectionEnabled(queries);
  const focus = useQuery({
    ...visibilityQueries.competitor(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      { name, ...topicSelectionParams(filters, queries) },
    ),
    enabled,
  });
  if (isUnknownCompetitor(focus.error))
    return (
      <StateBlock
        kind="empty"
        heading={`${name} isn’t a tracked competitor`}
        action={
          <Button asChild>
            <ProjectLink href="/agent/context?tab=competitors">Edit competitors</ProjectLink>
          </Button>
        }
      />
    );
  return (
    <SectionStack aria-busy={queries.visibilityQuery.isFetching}>
      <FocusFigures name={name} rankings={selected.rankings} />
      <CompetitorTrend name={name} query={queries.trendQuery} />
      <AnalysisRead
        query={focus}
        title={`Couldn't load ${name}'s sources and prompts`}
        busyLabel="Updating"
        busy={focus.isFetching}
        ready={focus.data}
      >
        {(data) => (
          <AppGrid layout="halves">
            <CompetitorSources focus={data} />
            <NamedInsteadOfYou focus={data} />
          </AppGrid>
        )}
      </AnalysisRead>
    </SectionStack>
  );
}

type Reading = { value: Formatted | null; missingLabel?: string };
type Figure = { key: string; label: string; read: (row: RankingRow) => Reading };

const plain = (value: Formatted | null): Reading => ({ value });

const FIGURES: readonly Figure[] = [
  {
    key: 'visibility',
    label: 'Visibility',
    read: (row) => plain(formatRate(row.mention_rate)),
  },
  {
    key: 'sov',
    label: 'Share of voice',
    read: (row) => plain(formatRate(row.share_of_voice)),
  },
  {
    key: 'position',
    label: 'Position',
    read: (row) => plain(formatPositionExact(row.avg_position)),
  },
  {
    key: 'win',
    label: 'Win rate',
    read: (row) =>
      plain(
        row.win_rate === null || row.win_rate === undefined
          ? absent(winRateAbsence(row))
          : formatRate(row.win_rate),
      ),
  },
  {
    key: 'sentiment',
    label: 'Sentiment',
    read: ({ sentiment }) => sentimentFigureValue(sentiment),
  },
];

function FocusFigures({
  name,
  rankings,
}: Readonly<{ name: string; rankings: readonly RankingRow[] }>) {
  const theirs = rankings.find((row) => !row.is_brand && row.name === name);
  const yours = rankings.find((row) => row.is_brand);
  const segments = FIGURES.map((figure): FigureSegment => {
    const mine = yours ? figure.read(yours) : plain(null);
    const yourValue = mine.value ?? absent();
    return {
      key: figure.key,
      label: figure.label,
      ...(theirs ? figure.read(theirs) : plain(null)),
      sub: (
        <>
          You:{' '}
          {isAbsent(yourValue) ? (
            <Absence state={yourValue.absent} label={mine.missingLabel} />
          ) : (
            yourValue
          )}
        </>
      ),
    };
  });
  return <FigureStrip label={`${name} against you`} segments={segments} subLine />;
}
