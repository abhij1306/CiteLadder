import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { metricItemClasses } from '@/components/ui/workspace';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MetricValue } from '@/components/ui/metric-value';
import { Delta } from '@/components/ui/delta';
import type { DataTone } from '@/components/ui/data-tone';
import { Meter } from '@/components/ui/meter';
import { TextLink } from '@/components/ui/text-link';
import { MissingValue } from '@/components/ui/unavailable-value';
import type { CommandCenter, Opportunity } from '@/lib/api/types';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { textRole } from '@/components/ui/typography';

/** A change against the previous comparable run, as every Command Center delta reads it. */
export const VS_PREVIOUS_RUN = {
  context: 'vs previous',
  missingReason: 'No comparable run',
} as const;

export function metricValue(value: number | null, suffix = '') {
  if (value === null) return availabilityLabel('not_measured');
  const figure = Number.isInteger(value) ? value : value.toFixed(1);
  return `${figure}${suffix}`;
}

export function StateMetric({
  label,
  value,
  delta,
  suffix,
  inverse,
}: Readonly<{
  label: string;
  value: number | null;
  delta: number | null;
  suffix?: string;
  inverse?: boolean;
}>) {
  return (
    <div className={metricItemClasses}>
      <dt className={textRole('label')}>{label}</dt>
      <dd>
        <MetricValue
          value={value === null ? null : metricValue(value, suffix)}
          label={availabilityLabel('not_measured')}
        />
      </dd>
      {/* A missing value or a missing comparison has no change to report; the
          Movement card states why once, rather than a dash under every figure. */}
      {value !== null && delta !== null ? (
        <dd>
          <Delta
            value={delta}
            policy={inverse ? 'lower-is-better' : 'higher-is-better'}
            {...VS_PREVIOUS_RUN}
          />
        </dd>
      ) : null}
    </div>
  );
}

/**
 * Each engine's brand mention rate in the previous and the current comparable
 * run. Both are shares of answers on the same 0–100 scale, so they are drawn as
 * meters against that scale rather than against the largest bar on screen. The
 * caller owns the empty case.
 */
export function MovementChart({ movements }: Readonly<{ movements: CommandCenter['movements'] }>) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {movements.map((row) => (
        <div key={row.label} className="grid min-w-0 content-start gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className={textRole('label', 'capitalize')}>{row.label}</span>
            <Delta value={row.delta} {...VS_PREVIOUS_RUN} />
          </div>
          <MovementMeter engine={row.label} period="Previous" value={row.previous} tone="neutral" />
          <MovementMeter
            engine={row.label}
            period="Current"
            value={row.current}
            tone={{ series: 1 }}
          />
        </div>
      ))}
    </div>
  );
}

function MovementMeter({
  engine,
  period,
  value,
  tone,
}: Readonly<{
  engine: string;
  period: 'Previous' | 'Current';
  value: number | null;
  tone: DataTone;
}>) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={textRole('caption', 'w-16 shrink-0')}>{period}</span>
      <Meter
        value={value}
        label={`${engine} ${period.toLowerCase()} mention rate`}
        tone={tone}
        className="min-w-0 flex-1"
      />
      <span className={textRole('caption', 'w-12 shrink-0 text-end tabular-nums')}>
        {value === null ? <MissingValue /> : metricValue(value, '%')}
      </span>
    </div>
  );
}

export function ActionRow({
  action,
  index,
  total,
  onMove,
  onDrop,
  reorderPending,
}: Readonly<{
  action: Opportunity;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onDrop: (from: number, to: number) => void;
  reorderPending: boolean;
}>) {
  const [dragging, setDragging] = useState(false);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Pointer drag is progressive enhancement; adjacent buttons provide the complete keyboard reorder path.
    <li
      draggable={!reorderPending}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(index));
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!reorderPending) onDrop(Number(event.dataTransfer.getData('text/plain')), index);
      }}
      className={cn(
        'border-border-subtle hover:bg-hover active:bg-active grid gap-3 border-b py-3 transition-colors last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center',
        dragging && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="text-muted hover:text-foreground size-4 cursor-grab" aria-hidden />
        <span className={textRole('label', 'w-5 text-center tabular-nums')}>{index + 1}</span>
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <TextLink
            text="itemTitle"
            href={action.action_id ? `/agent/actions/${action.action_id}` : '/agent/actions'}
          >
            {action.title}
          </TextLink>
          {action.severity === 'critical' ? (
            <Badge variant="status" value="danger">
              {action.severity}
            </Badge>
          ) : (
            <Badge>{action.severity}</Badge>
          )}
        </div>
        <p className="type-caption truncate">
          {action.target_label ?? 'Project-wide'} · {action.evidence_summary.count} persisted
          evidence item(s)
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className={textRole('figureSm', 'me-2')}>{action.priority_score.toFixed(1)}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onMove(index, index - 1)}
          disabled={reorderPending || index === 0}
          aria-label={`Move ${action.title} up`}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onMove(index, index + 1)}
          disabled={reorderPending || index === total - 1}
          aria-label={`Move ${action.title} down`}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
