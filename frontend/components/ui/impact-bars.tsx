const BARS = [
  { x: 0, height: 5 },
  { x: 5, height: 8 },
  { x: 10, height: 12 },
] as const;

function barFill(index: number, level: 1 | 2 | 3) {
  if (index >= level) return 'fill-control-line';
  return level === 3 ? 'fill-negative' : 'fill-ink';
}

export function ImpactBars({ level, children }: Readonly<{ level: 1 | 2 | 3; children: string }>) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <svg aria-hidden width={13} height={12} viewBox="0 0 13 12" className="shrink-0">
        {BARS.map((bar, index) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={12 - bar.height}
            width={3}
            height={bar.height}
            rx={1}
            className={barFill(index, level)}
          />
        ))}
      </svg>
      {children}
    </span>
  );
}
