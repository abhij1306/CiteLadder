import { useQuery } from '@tanstack/react-query';

import { ReportPage } from '@/components/templates/report-page';
import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { SectionStack } from '@/components/ui/section';
import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { CompetitorSuggestions } from '@/components/visibility/prompt-insights';
import { RankingRowsPending, RankingRowsTable } from '@/components/visibility/ranking-rows';
import { SelectionGate } from '@/components/visibility/selection-gate';
import {
  SelectionPageStateBlock,
  selectionPageFilterBar,
  selectionPageState,
  useSelectionPageFilters,
} from '@/components/visibility/selection-page';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { subsetChangeNote } from '@/lib/visibility/coverage';
import {
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

export function CompetitorsScreen() {
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(filters, 'competitors');
  const state = selectionPageState(queries);
  const pageFilters = useSelectionPageFilters({ view: 'competitors', filters, queries });
  const { project } = useProjectScope();
  const suggestions = useQuery(
    visibilityQueries.competitorSuggestions({
      workspaceId: queries.workspaceId,
      projectId: queries.projectId,
    }),
  );
  return (
    <ReportPage
      actions={
        <Button variant="secondary" asChild>
          <ProjectLink href="/agent/context?tab=competitors">Edit competitors</ProjectLink>
        </Button>
      }
      filters={selectionPageFilterBar(state, pageFilters)}
    >
      {queries.activeRun && state !== 'empty' ? <ActiveRunBanner run={queries.activeRun} /> : null}
      {state && state !== 'loading' ? (
        <SelectionPageStateBlock state={state} queries={queries} />
      ) : (
        <SectionStack>
          <SelectionGate
            query={queries.visibilityQuery}
            pending={<RankingRowsPending brands={project.competitors.length + 1} />}
          >
            {(selected) => (
              <RankingRowsTable
                rows={selected.rankings}
                description={subsetChangeNote(selected) ?? undefined}
              />
            )}
          </SelectionGate>
          <CompetitorSuggestions
            projectId={queries.projectId}
            tracked={project.competitors.length}
            suggestionsQuery={suggestions}
          />
        </SectionStack>
      )}
    </ReportPage>
  );
}
