import { Badge } from '@/components/ui/badge';
import { Delta } from '@/components/ui/delta';
import type { DataTone } from '@/components/ui/data-tone';
import { Inline, Stack } from '@/components/ui/layout';
import { MeterRow } from '@/components/ui/meter';
import type { ReorderItem } from '@/components/ui/reorder-list';
import { TextLink } from '@/components/ui/text-link';
import { MissingValue } from '@/components/ui/unavailable-value';
import type { CommandCenter, Opportunity } from '@/lib/api/types';
import { availabilityLabel } from '@/lib/format';
import { textRole } from '@/components/ui/typography';
import { splitPaneClasses } from '@/components/ui/workspace';

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

/**
 * Each engine's brand mention rate in the previous and the current comparable
 * run. Both are shares of answers on the same 0–100 scale, so they are drawn as
 * meters against that scale rather than against the largest bar on screen. The
 * caller owns the empty case.
 */
export function MovementChart({ movements }: Readonly<{ movements: CommandCenter['movements'] }>) {
  return (
    <div className={splitPaneClasses('peers')}>
      {movements.map((row) => (
        <Stack key={row.label} gap="compact" className="min-w-0 content-start">
          <Inline className="justify-between">
            <span className={textRole('label', 'capitalize')}>{row.label}</span>
            <Delta value={row.delta} {...VS_PREVIOUS_RUN} />
          </Inline>
          <MovementMeter engine={row.label} period="Previous" value={row.previous} tone="neutral" />
          <MovementMeter
            engine={row.label}
            period="Current"
            value={row.current}
            tone={{ series: 1 }}
          />
        </Stack>
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
    <MeterRow
      name={period}
      figure={value === null ? <MissingValue /> : metricValue(value, '%')}
      value={value}
      label={`${engine} ${period.toLowerCase()} mention rate`}
      tone={tone}
    />
  );
}

/** One ranked action, as a row of the shared reorderable list. */
export function actionItem(action: Opportunity): ReorderItem {
  return {
    key: action.id,
    name: action.title,
    figure: <span className={textRole('figureSm')}>{action.priority_score.toFixed(1)}</span>,
    content: (
      <Stack gap="tight">
        <Inline className="flex-wrap">
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
        </Inline>
        <p className="type-caption truncate">
          {action.target_label ?? 'Project-wide'} · {action.evidence_summary.count} persisted
          evidence item(s)
        </p>
      </Stack>
    ),
  };
}
