import { AppGrid } from '@/components/ui/app-grid';
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
import { severityBadgeValue, severityLabel } from '@/lib/site-health/issues';
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

/**
 * Each engine's brand mention rate in the previous and the current comparable
 * run. Both are shares of answers on the same 0–100 scale, so they are drawn as
 * meters against that scale rather than against the largest bar on screen. The
 * caller owns the empty case.
 */
export function MovementChart({ movements }: Readonly<{ movements: CommandCenter['movements'] }>) {
  return (
    <AppGrid layout="halves">
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
    </AppGrid>
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
    // The severity badge carries the priority; the score is not repeated
    // (decision D14). The title truncates so the badge stays on its line.
    content: (
      <Stack gap="tight">
        <Inline>
          <TextLink
            text="itemTitle"
            className="min-w-0 truncate"
            title={action.title}
            href={action.action_id ? `/agent/actions/${action.action_id}` : '/agent/actions'}
          >
            {action.title}
          </TextLink>
          {/* The one severity mapping the evidence drawer and Site Health use. */}
          <Badge variant="status" value={severityBadgeValue(action.severity)}>
            {severityLabel(action.severity)}
          </Badge>
        </Inline>
        <p className="type-caption truncate">
          {action.target_label ?? 'Project-wide'} · {action.evidence_summary.count} persisted
          evidence item(s)
        </p>
      </Stack>
    ),
  };
}
