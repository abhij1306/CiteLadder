import { AppGrid } from '@/components/ui/app-grid';
import { ChartFrame } from '@/components/ui/chart-frame';
import { ClampText } from '@/components/ui/clamp-text';
import { StatusMark } from '@/components/ui/status-mark';
import { Delta } from '@/components/ui/delta';
import { Inline, Stack } from '@/components/ui/layout';
import { MeterRow } from '@/components/ui/meter';
import type { ReorderItem } from '@/components/ui/reorder-list';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import type { CommandCenter, Opportunity } from '@citeladder/contracts';
import { percentText, pluralCount, readableUrl } from '@/lib/format';
import { useEngineCatalog } from '@/lib/providers/engines';
import { severityLabel, severityPriority } from '@/lib/site-health/issues';
import { textRole } from '@/components/ui/typography';

export const VS_PREVIOUS_RUN = {
  spokenContext: 'compared with the previous run',
  missingReason: 'No comparable run',
} as const;

export const percentFigure = (value: number) => percentText(value / 100);

export function MovementChart({ movements }: Readonly<{ movements: CommandCenter['movements'] }>) {
  const engines = useEngineCatalog();
  const summary = movements
    .map(
      (row) =>
        `${engines.label(row.label)}: ${row.previous === null ? 'no reading' : percentFigure(row.previous)} to ${row.current === null ? 'no reading' : percentFigure(row.current)}`,
    )
    .join('; ');
  return (
    <ChartFrame summary={`Mention rate by engine, previous to current run. ${summary}.`}>
      <AppGrid layout="halves">
        {movements.map((row) => (
          <Stack key={row.label} gap="compact" className="min-w-0">
            <Inline className="justify-between">
              <span className={textRole('label')}>{engines.label(row.label)}</span>
              <Delta value={row.delta} unit=" pp" {...VS_PREVIOUS_RUN} />
            </Inline>
            <MovementMeter
              engine={engines.label(row.label)}
              period="Previous"
              value={row.previous}
              tone="neutral"
            />
            <MovementMeter
              engine={engines.label(row.label)}
              period="Current"
              value={row.current}
              tone="accent"
            />
          </Stack>
        ))}
      </AppGrid>
    </ChartFrame>
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
  tone: 'neutral' | 'accent';
}>) {
  return (
    <MeterRow
      name={period}
      figure={value === null ? <Absence /> : percentFigure(value)}
      value={value}
      label={`${engine} ${period.toLowerCase()} mention rate`}
      tone={tone}
    />
  );
}

function actionScope(action: Opportunity): string {
  const label = action.target_label;
  const echoes = label?.toLowerCase().startsWith(action.title.toLowerCase());
  const target = label && !echoes ? readableUrl(label) : null;
  const evidence = pluralCount(action.evidence_summary.count, 'evidence item');
  return target ? `${target} · ${evidence}` : evidence;
}

function ActionPriority({ action }: Readonly<{ action: Opportunity }>) {
  return (
    <StatusMark variant="priority" value={severityPriority(action.severity)}>
      {severityLabel(action.severity)}
    </StatusMark>
  );
}

export function ActionFacts({ action }: Readonly<{ action: Opportunity }>) {
  return (
    <Inline>
      <ActionPriority action={action} />
      <ClampText className={textRole('caption', 'min-w-0 flex-1')}>{actionScope(action)}</ClampText>
    </Inline>
  );
}

export function actionItem(action: Opportunity): ReorderItem {
  return {
    key: action.id,
    name: action.title,
    content: (
      <Inline gap="item" className="min-w-0">
        <TextLink
          text="body"
          underline="hover"
          className="flex min-w-0"
          href={action.action_id ? `/actions/${action.action_id}` : '/actions'}
        >
          <ClampText>{action.title}</ClampText>
        </TextLink>
        <ClampText className={textRole('body', 'text-ink-2 min-w-0 flex-1')}>
          {actionScope(action)}
        </ClampText>
        <ActionPriority action={action} />
      </Inline>
    ),
  };
}
