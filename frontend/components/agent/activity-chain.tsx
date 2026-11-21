import { FoldedTrail, type TrailStep } from '@/components/ui/rung-trail';
import { STEP_SLIP } from '@/components/ui/slip';
import { activityLabel, activitySummary, type ActivityRow } from '@/lib/agent/activity';

export function ActivityChain({ rows }: Readonly<{ rows: readonly ActivityRow[] }>) {
  if (rows.length === 0) return null;
  return (
    <div className={STEP_SLIP}>
      <FoldedTrail
        summary={activitySummary(rows)}
        label="Agent activity"
        steps={activitySteps(rows)}
      />
    </div>
  );
}

export function activitySteps(rows: readonly ActivityRow[]): TrailStep[] {
  return rows.map((row) => ({
    id: row.key,
    label: activityLabel(row),
    detail: row.detail,
    status: row.state,
  }));
}
