'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { scoreBand, scoreBandStroke, scoreBandText } from './score-band';

/**
 * ScoreRing — circular progress. Color from the score-band token, center
 * shows the tabular display number. Carries an ARIA label with the percentage
 * (role="img") so the value is announced to assistive tech.
 *
 * `numeralSize` sets the center numeral: `md` = the `figureSm` role, `lg` and
 * `hero` = the `figure` role — the ceiling, so the ring never out-shouts the
 * page title. Pair the larger
 * numerals with a larger `size`/`strokeWidth`. The numeral stays
 * `aria-hidden`; the ring's svg keeps the accessible label either way.
 *
 * The arc sweeps to its value with the slow motion role on mount. `motion-reduce` drops the
 * transition so the ring simply appears at its final value.
 */
const NUMERAL_SIZE_CLASS: Record<'md' | 'lg' | 'hero', string> = {
  hero: 'type-figure',
  lg: 'type-figure',
  md: 'type-figure-sm',
};

export function ScoreRing({
  value,
  size = 96,
  strokeWidth = 8,
  label,
  showValue = true,
  numeralSize = 'md',
  className,
}: Readonly<{
  /** Score 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Accessible label; defaults to "Visibility score: N%". */
  label?: string;
  showValue?: boolean;
  /** Center numeral: `md` = figureSm (default), `lg` and `hero` = figure. */
  numeralSize?: 'md' | 'lg' | 'hero';
  className?: string;
}>) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const band = scoreBand(clamped);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const ariaLabel = label ?? `Visibility score: ${clamped}%`;

  // A CSS transition only animates a CHANGE, so the arc has to be painted empty
  // first and moved to its value afterwards — rendering it at `dashOffset` from
  // the start would just appear there with the transition never firing. Under
  // `motion-reduce` the transition is off, so the same two paints read as the
  // ring simply appearing at its final value.
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG is the semantic image; img cannot render this generated score ring.
        role="img"
        aria-label={ariaLabel}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-well"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={swept ? dashOffset : circumference}
          className={cn(
            'transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            scoreBandStroke[band],
          )}
        />
      </svg>
      {showValue ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center',
            NUMERAL_SIZE_CLASS[numeralSize],
            scoreBandText[band],
          )}
        >
          {clamped}
        </span>
      ) : null}
    </div>
  );
}
