import { scoreBand, type ScoreBand } from '@/lib/score-band';
import { cn } from '@/lib/utils';

/**
 * A score's tone: `ink` for a single score; `auto` colours by band where
 * scores are compared — `positive` from 80, `warning` from 50, `negative`
 * below. The numeral inside the ring keeps the foreground ink.
 */
export type ScoreTone = 'ink' | 'auto';

type ScoreFill = 'ink' | 'positive' | 'warning' | 'negative';

const BAND_FILL = {
  high: 'positive',
  mid: 'warning',
  low: 'negative',
} as const satisfies Record<ScoreBand, ScoreFill>;

function scoreFill(tone: ScoreTone, value: number): ScoreFill {
  return tone === 'ink' ? 'ink' : BAND_FILL[scoreBand(value)];
}

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const RING_STROKE = {
  ink: 'stroke-ink',
  positive: 'stroke-positive',
  warning: 'stroke-warning',
  negative: 'stroke-negative',
} as const satisfies Record<ScoreFill, string>;

/** The one size: 64px with a 5px stroke, room for "100" in the 24px figure. */
const SIZE = 64;
const STROKE = 5;

/**
 * ScoreRing — a 0–100 score as a ring, the app's only score graphic
 * (decisions D8, D48): 64px with the number at its centre in the metric
 * figure (500, 24/32). A `chart-grid` track; the arc is `ink`, or banded
 * with `tone="auto"` where several scores are compared and in score stats.
 * Shares are a `StackedBar`. It has no other size and shows no percent sign.
 */
export function ScoreRing({
  value,
  label,
  tone = 'ink',
}: Readonly<{
  /** Score 0–100. */
  value: number;
  /** The accessible name, e.g. "Site Health score". */
  label: string;
  tone?: ScoreTone;
}>) {
  const score = clampScore(value);
  const centre = SIZE / 2;
  const radius = centre - STROKE / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The ring and its numeral are one generated image; <img> cannot hold them.
      role="img" // NOSONAR -- the ring and its numeral are one generated image
      aria-label={`${label}: ${score} out of 100`}
      className="relative inline-grid size-16 shrink-0 place-items-center"
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        className="absolute inset-0"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-chart-grid"
        />
        {score > 0 ? (
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
            transform={`rotate(-90 ${centre} ${centre})`}
            className={cn(RING_STROKE[scoreFill(tone, score)])}
          />
        ) : null}
      </svg>
      <span aria-hidden className="type-figure relative">
        {score}
      </span>
    </div>
  );
}
