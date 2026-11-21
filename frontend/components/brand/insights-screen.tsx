import { useLocation, useNavigate } from 'react-router-dom';

import { PerformanceMatrix } from '@/components/brand/performance-matrix';
import { TopRankings } from '@/components/brand/top-rankings';
import { ReportPage } from '@/components/templates/report-page';
import { SectionStack } from '@/components/ui/section';
import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { EngineComparison } from '@/components/visibility/engine-comparison';
import { SelectionGate } from '@/components/visibility/selection-gate';
import {
  SelectionPageStateBlock,
  selectionPageFilterBar,
  selectionPageState,
  useSelectionPageFilters,
} from '@/components/visibility/selection-page';
import { SurfaceRatesPanel } from '@/components/visibility/surface-rates';
import { VisibilityByMarket } from '@/components/visibility/visibility-by-market';
import { VisibilityByTopic } from '@/components/visibility/visibility-by-topic';
import { BrandTrend, InsightsLede } from '@/components/visibility/visibility-trends';
import { useProjectHref } from '@/lib/navigation/project-destination';
import {
  useVisibilityFilters,
  useVisibilityQueries,
  visibilityEvidenceHref,
} from '@/lib/visibility/use-visibility-dashboard';

export function InsightsScreen() {
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(filters, 'insights');
  const state = selectionPageState(queries);
  const pageFilters = useSelectionPageFilters({ view: 'insights', filters, queries });
  const navigate = useNavigate();
  const { search } = useLocation();
  const projectHref = useProjectHref();
  return (
    <ReportPage filters={selectionPageFilterBar(state, pageFilters)}>
      {queries.activeRun && state !== 'empty' ? <ActiveRunBanner run={queries.activeRun} /> : null}
      {state ? (
        <SelectionPageStateBlock state={state} queries={queries} />
      ) : (
        <SectionStack>
          <SelectionGate query={queries.visibilityQuery}>
            {(selected) => (
              <SectionStack aria-busy={queries.visibilityQuery.isFetching}>
                <InsightsLede selected={selected} />
                <BrandTrend query={queries.trendQuery} selected={selected} />
                <PerformanceMatrix query={queries.matrixQuery} selected={selected} />
                <TopRankings query={queries.matrixQuery} selected={selected} />
                <VisibilityByTopic
                  query={queries.topicsQuery}
                  topic={filters.topic}
                  onSelectTopic={filters.setTopic}
                />
                <EngineComparison
                  visibility={selected}
                  filter={filters.engine}
                  onSelect={(engine) =>
                    void navigate(
                      projectHref(
                        visibilityEvidenceHref(search, { run: selected.audit_id, engine }),
                      ),
                    )
                  }
                />
                {queries.surfaceEngine ? (
                  <SurfaceRatesPanel query={queries.surfaceRatesQuery} />
                ) : null}
              </SectionStack>
            )}
          </SelectionGate>
          <VisibilityByMarket
            query={queries.marketRowsQuery}
            markets={queries.markets}
            market={filters.market}
            onSelectMarket={filters.setMarket}
          />
        </SectionStack>
      )}
    </ReportPage>
  );
}
