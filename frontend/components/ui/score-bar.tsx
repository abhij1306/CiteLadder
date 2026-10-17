'use client';

import { Meter } from './meter';
import { scoreBand, scoreBandTone } from './score-band';

/** A 0–100 score as a `Meter` in the score-band tone, sweeping in like ScoreRing. */
export function ScoreBar({
  value,
  label,
  className,
}: Readonly<{ value: number; label?: string; className?: string }>) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <Meter
      value={clamped}
      label={label ?? `Score: ${clamped} out of 100`}
      valueText={`${clamped} out of 100`}
      size="md"
      sweep
      tone={scoreBandTone[scoreBand(clamped)]}
      className={className}
    />
  );
}
