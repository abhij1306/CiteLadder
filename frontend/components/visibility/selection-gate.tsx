import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import { Callout } from '@/components/ui/callout';
import { QueryState, screenState } from '@/components/ui/query-state';
import type { Visibility } from '@citeladder/contracts';
import { isMetricsPending } from '@/lib/api/visibility-queries';

/**
 * A projection that names a measured run. A range counts only when it lists
 * the runs it pooled: without them the tabs' reads would have no run set to
 * scope to.
 */
function isMeasured(data: Visibility | null): data is Visibility {
  if (data === null) return false;
  if (data.selection_mode !== 'range') return true;
  return (data.source_audit_ids?.length ?? 0) > 0;
}

/**
 * The selection's projection, before any Visibility tab reads from it.
 *
 * Every tab's own reads wait on the run this projection resolves, so until it
 * answers they are disabled with no data. A tab that consulted only its own
 * query reported that as a finding ("No answers named you", "No sources were
 * used") about a selection nobody had read (invariant 7). Five answers are
 * kept apart here, once, for every tab: still loading, a failed read with
 * Retry, metrics still being written for a run that finished, nothing measured
 * in the selection, and a measured run, which is the only one that reaches
 * the tab.
 */
export function SelectionGate({
  query,
  children,
}: Readonly<{
  query: UseQueryResult<Visibility | null, unknown>;
  children: (selected: Visibility) => ReactNode;
}>) {
  // Metrics not written yet is the normal state for the seconds after a run
  // ends; reporting it as an error told readers their results were lost.
  if (query.status === 'error' && isMetricsPending(query.error)) {
    return (
      <Callout tone="info">
        Results for this run are still being prepared. They appear here as soon as they are ready.
      </Callout>
    );
  }
  const state = screenState(query, {
    subject: 'the selected measurement',
    measured: isMeasured,
    notMeasured: {
      description: 'Results appear here once a run in this selection finishes measuring.',
    },
  });
  if (state.kind === 'state') return <QueryState {...state.state} />;
  return children(state.data);
}
