import { Badge } from '@/components/ui/badge';
import {
  ACTION_STATUS_LABEL,
  ACTION_STATUS_TONE,
  PRIORITY_BAND_TONE,
  priorityBand,
} from '@/lib/agent/vocabulary';
import type { ActionStatus } from '@/lib/api/actions';

/** An Action's workflow status: a labelled state mark, never colour alone. */
export function ActionStatusBadge({ status }: Readonly<{ status: ActionStatus }>) {
  const tone = ACTION_STATUS_TONE[status];
  const label = ACTION_STATUS_LABEL[status];
  return tone === 'neutral' ? (
    <Badge>{label}</Badge>
  ) : (
    <Badge variant="status" value={tone}>
      {label}
    </Badge>
  );
}

/** An Action's priority as High, Medium or Low; an unscored Action says so. */
export function ActionPriorityBadge({ score }: Readonly<{ score: number | null }>) {
  if (score === null) return <Badge>Not scored</Badge>;
  const band = priorityBand(score);
  return (
    <Badge variant="status" value={PRIORITY_BAND_TONE[band]}>
      {band}
    </Badge>
  );
}
