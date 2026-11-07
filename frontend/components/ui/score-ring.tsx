import { cn } from '@/lib/utils';

/**
 * A score's tone: `ink` for a single score; `auto` colours by band where
 * scores are compared — `positive` from 80, `warning` from 50, `negative`
 * below. The numeral inside the ring keeps the foreground ink.
 */
export type ScoreTone = 'ink' | 'auto';

type ScoreFill = 'ink' | 'positive' | 'warning' | 'negative';

function scoreFill(tone: ScoreTone, value: number): ScoreFill {
  if (tone === 'ink') return 'ink';
  if (value >= 80) return 'positive';
  return value >= 50 ? 'warning' : 'negative';
}

export const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const RING_STROKE = {
  ink: 'stroke-ink',
  positive: 'stroke-positive',
  warning: 'stroke-warning',
  negative: 'stroke-negative',
} as const satisfies Record<ScoreFill, string>;

/** The two sizes: 96px with the number at the centre, 48px bare beside a score card's number. */
const RING = {
  full: { size: 96, stroke: 8, box: 'size-24' },
  bare: { size: 48, stroke: 6, box: 'size-12' },
} as const;

/**
 * ScoreRing — a 0–100 score as a ring, the app's only score graphic
 * (decision D8): 96px with the number at its centre in Geist 500 32/38 (the
 * Site Health score, a page's readiness), or bare at 48px (`showValue={false}`)
 * beside a score card's number. A `chart-grid` track; the arc is `ink`, or
 * banded with `tone="auto"` where several scores are compared and in score
 * cards. Pair the 96px ring with the failing count and the crawl time beside
 * it, never alone; shares are a `StackedBar`. It has no other size and shows
 * no percent sign.
 */
export function ScoreRing({
  value,
  label,
  tone = 'ink',
  showValue = true,
}: Readonly<{
  /** Score 0–100. */
  value: number;
  /** The accessible name, e.g. "Site Health score". */
  label: string;
  tone?: ScoreTone;
  /** `false` draws the bare 48px ring a score card puts beside its number. */
  showValue?: boolean;
}>) {
  const score = clampScore(value);
  const { size, stroke, box } = RING[showValue ? 'full' : 'bare'];
  const centre = size / 2;
  const radius = centre - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The ring and its numeral are one generated image; <img> cannot hold them.
      role="img" // NOSONAR -- the ring and its numeral are one generated image
      aria-label={`${label}: ${score} out of 100`}
      className={cn('relative inline-grid shrink-0 place-items-center', box)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className="absolute inset-0"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-chart-grid"
        />
        {score > 0 ? (
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
            transform={`rotate(-90 ${centre} ${centre})`}
            className={cn(RING_STROKE[scoreFill(tone, score)])}
          />
        ) : null}
      </svg>
      {showValue ? (
        <span aria-hidden className="type-figure-ring relative">
          {score}
        </span>
      ) : null}
    </div>
  );
}
