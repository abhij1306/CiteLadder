import { cn } from '@/lib/utils';

export const FRAME_FACE = 'border border-rule rounded-card';

export const SLIP_FACE = cn('bg-surface text-ink', FRAME_FACE);

export function slipClasses(className?: string) {
  return cn('surface-slip p-[var(--card-padding)]', SLIP_FACE, className);
}

export const STEP_SLIP = cn('surface-slip min-w-0 px-4 py-3', SLIP_FACE);

export function wellClasses(className?: string) {
  return cn('surface-well bg-well rounded-control p-[var(--card-padding)]', className);
}

export const SHEET_FACE = 'bg-surface text-ink border-rule rounded-overlay border shadow-sheet';

export const POP_FACE = 'bg-raised text-ink border-rule rounded-card border shadow-pop';
