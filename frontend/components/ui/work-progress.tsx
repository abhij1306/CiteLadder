import type { ReactNode } from 'react';

import { Inline, Stack } from '@/components/ui/layout';
import { ProgressMeter } from '@/components/ui/progress-meter';
import { Section } from '@/components/ui/section';
import { Spinner } from '@/components/ui/spinner';

export type WorkMeter = Readonly<{ label: string; value: number }>;

export function WorkProgress({
  label,
  narration,
  meter,
  action,
}: Readonly<{ label: string; narration: string; meter?: WorkMeter | null; action?: ReactNode }>) {
  return (
    <Section variant="framed" aria-label={label}>
      <Stack gap="item">
        <Inline className="flex-wrap justify-between">
          <Inline>
            <Spinner />
            <span className="type-body min-w-0" aria-live="polite">
              {narration}
            </span>
          </Inline>
          {action}
        </Inline>
        {meter ? <ProgressMeter label={meter.label} value={meter.value} /> : null}
      </Stack>
    </Section>
  );
}

export function countMeter({
  done,
  total,
  label,
}: Readonly<{ done: number; total: number; label: string }>): WorkMeter | null {
  return total > 0 ? { label, value: Math.min(100, (done / total) * 100) } : null;
}
