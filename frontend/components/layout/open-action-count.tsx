'use client';

import { textRole } from '@/components/ui/typography';
import { queueCount, useActionStatusCounts } from '@/lib/agent/use-action-status-counts';

/** Open plus in-progress Actions for the active project, beside the Actions destination. */
export function OpenActionCount() {
  const counts = useActionStatusCounts();
  if (!counts) return null;
  const count = queueCount(counts);
  return (
    <>
      <span aria-hidden className={textRole('caption', 'tabular-nums')}>
        {count}
      </span>
      <span className="sr-only">, {count} open</span>
    </>
  );
}
