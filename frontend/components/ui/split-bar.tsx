import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export type SplitSegment = Readonly<{ key: string; label: string }>;

const FILLS = ['bg-data-rival-2/20', 'bg-data-rival-3/20', 'bg-data-rival-4/20'] as const;
const DOTS = ['bg-data-rival-2', 'bg-data-rival-3', 'bg-data-rival-4'] as const;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const percent = (value: number | undefined) => `${value ?? 0}%`;

function moved(
  values: readonly number[],
  index: number,
  position: number,
  { step, min }: { step: number; min: number },
): number[] {
  const start = sum(values.slice(0, index));
  const end = start + (values[index] ?? 0) + (values[index + 1] ?? 0);
  const snapped = Math.round(position / step) * step;
  const at = Math.min(end - min, Math.max(start + min, snapped));
  return values.map((value, i) => {
    if (i === index) return at - start;
    if (i === index + 1) return end - at;
    return value;
  });
}

export function SplitBar({
  label,
  segments,
  values,
  onChange,
  step = 5,
  min = 0,
  disabled = false,
}: Readonly<{
  label: string;
  segments: readonly SplitSegment[];
  values: readonly number[];
  onChange: (values: number[]) => void;
  step?: number;
  min?: number;
  disabled?: boolean;
}>) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const bounds = { step, min };
  const dividers = segments.slice(0, -1).map((_, index) => sum(values.slice(0, index + 1)));

  const positionAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box && box.width > 0 ? ((clientX - box.left) / box.width) * 100 : null;
  };
  const nearest = (position: number) =>
    dividers.reduce((best, at, index) => {
      const distance = Math.abs(at - position);
      const bestDistance = Math.abs((dividers[best] ?? 0) - position);
      if (distance < bestDistance) return index;
      return distance === bestDistance && position > at ? index : best;
    }, 0);
  const moveTo = (index: number, position: number) => {
    const next = moved(values, index, position, bounds);
    if (next.some((value, i) => value !== values[i])) onChange(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const position = positionAt(event.clientX);
    if (position === null) return;
    const index = nearest(position);
    dragging.current = index;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    moveTo(index, position);
    track.current
      ?.querySelectorAll<HTMLElement>('[role="slider"]')
      [index]?.focus({ preventScroll: true });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const position = positionAt(event.clientX);
    if (dragging.current !== null && position !== null) moveTo(dragging.current, position);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const at = dividers[index] ?? 0;
    const target = {
      ArrowRight: at + step,
      ArrowUp: at + step,
      ArrowLeft: at - step,
      ArrowDown: at - step,
      Home: 0,
      End: 100,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveTo(index, target);
  };

  return (
    <fieldset aria-label={label} className="grid min-w-0 gap-2">
      <div
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        className={cn(
          'relative flex h-6 min-w-0 touch-none select-none',
          disabled ? 'opacity-45' : 'cursor-pointer',
        )}
      >
        <div aria-hidden className="rounded-control flex min-w-0 flex-1 overflow-hidden">
          {segments.map((segment, index) => (
            <span
              key={segment.key}
              className={cn(FILLS[index % FILLS.length], 'h-full')}
              style={{ width: `${values[index] ?? 0}%` }}
            />
          ))}
        </div>
        {dividers.map((at, index) => {
          const left = segments[index];
          const right = segments[index + 1];
          if (!left || !right) return null;
          return (
            <div
              key={left.key}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${left.label} and ${right.label}`}
              aria-valuemin={sum(values.slice(0, index)) + min}
              aria-valuemax={sum(values.slice(0, index + 2)) - min}
              aria-valuenow={at}
              aria-valuetext={`${left.label} ${percent(values[index])}, ${right.label} ${percent(values[index + 1])}`}
              aria-disabled={disabled || undefined}
              onKeyDown={(event) => onKey(event, index)}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (disabled) return;
                dragging.current = index;
                track.current?.setPointerCapture?.(event.pointerId);
              }}
              style={{ left: `${at}%` }}
              className="focus-ring rounded-control absolute inset-y-[-4px] grid w-3 -translate-x-1/2 cursor-ew-resize place-items-center pointer-coarse:w-11"
            >
              <span className="bg-panel h-6 w-0.5" />
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment, index) => (
          <li key={segment.key} className={textRole('caption', 'flex items-center gap-1.5')}>
            <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[index % DOTS.length])} />
            {segment.label}
            <span className="text-ink tabular-nums">{percent(values[index])}</span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
