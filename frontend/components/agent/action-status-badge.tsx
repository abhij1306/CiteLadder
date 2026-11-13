import { Badge } from '@/components/ui/badge';
import {
  ACTION_STATUS_LABEL,
  ACTION_STATUS_TONE,
  PRIORITY_BAND_LABEL,
  PRIORITY_BAND_VALUE,
} from '@/lib/agent/vocabulary';
import type { ActionPriorityBand, ActionStatus } from '@/lib/api/actions';

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
export function ActionPriorityBadge({ band }: Readonly<{ band: ActionPriorityBand | null }>) {
  if (band === null) return <Badge>Not scored</Badge>;
  return (
    <Badge variant="priority" value={PRIORITY_BAND_VALUE[band]}>
      {PRIORITY_BAND_LABEL[band]}
    </Badge>
  );
}
