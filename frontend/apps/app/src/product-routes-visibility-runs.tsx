import { RunDetailScreen } from '@/components/runs/run-detail-screen';
import { RunsScreen } from '@/components/runs/runs-screen';
import { VisibilityScreen } from '@/components/visibility/visibility-screen';

/** `/visibility`: active-project AI visibility workspace and URL-backed tabs. */
export function VisibilityRouteElement() {
  return <VisibilityScreen />;
}

/** `/runs`: active-project audit list, status filter, launch, and schedules. */
export function RunsRouteElement() {
  return <RunsScreen />;
}

/** `/runs/:runId`: active run progress, retry/cancel, and evidence detail. */
export function RunDetailRouteElement() {
  return <RunDetailScreen />;
}
