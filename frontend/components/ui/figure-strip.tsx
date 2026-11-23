import { Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';

import { Absence } from '@/components/ui/absence';
import { cssVars } from '@/lib/css-vars';
import { Delta } from '@/components/ui/delta';
import {
  cellWidth,
  FIGURE_MIN_WIDTH,
  figureRowCells,
  useStripWidth,
} from '@/components/ui/figure-rows';
import { InfoHint } from '@/components/ui/info-hint';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  type Absent,
  availabilityLabel,
  type DataAvailabilityState,
  type Formatted,
  isAbsent,
} from '@/lib/format';
import type { IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

type FigureValue = {
  value: ReactNode | Absent;
  icon?: IconGlyph;
};

type FigureAction =
  | { onSelect?: undefined; actionLabel?: undefined; selected?: undefined }
  | { onSelect: () => void; actionLabel: string; selected?: boolean };

type FigureLink = Readonly<
  { label: string } & (
    | { href: string; projectId?: string; onSelect?: undefined }
    | { onSelect: () => void; href?: undefined; projectId?: undefined }
  )
>;

export type FigureSegment = Readonly<
  {
    key: string;
    label: ReactNode;
    labelHidden?: boolean;
    missingState?: DataAvailabilityState;
    missingLabel?: string;
    loading?: boolean;
    marker?: ReactNode;
    caption?: ReactNode;
    delta?: ReactNode;
    sub?: ReactNode;
    comparison?: Readonly<{ label: ReactNode; value: Formatted | null }>;
    action?: FigureLink;
  } & FigureValue &
    FigureAction
>;

export function FigureStrip({
  segments,
  label,
  testId,
  lead,
  subLine = false,
  twoLineLabels = false,
  textValues = false,
}: Readonly<{
  segments: readonly FigureSegment[];
  label?: string;
  testId?: string;
  lead?: ReactNode;
  subLine?: boolean;
  twoLineLabels?: boolean;
  textValues?: boolean;
}>) {
  const { ref, width } = useStripWidth<HTMLDivElement>();
  const cells = figureRowCells({ count: segments.length, width });
  return (
    <div ref={ref} data-figure-strip-frame="" className="grid min-w-0 gap-4">
      {lead ? <div data-figure-lead="">{lead}</div> : null}
      <dl // NOSONAR
        role={label ? 'group' : undefined}
        aria-label={label}
        data-testid={testId}
        data-figure-strip=""
        className="flex min-w-0 flex-wrap"
      >
        {segments.map((segment, index) => {
          const size = cells[index] ?? 1;
          return (
            <FigureCell
              key={segment.key}
              segment={segment}
              subLine={subLine}
              textValues={textValues}
              rowSize={size}
              narrow={twoLineLabels || cellWidth(width, size) < FIGURE_MIN_WIDTH}
            />
          );
        })}
      </dl>
    </div>
  );
}

function FigureCell({
  segment,
  subLine,
  textValues,
  rowSize,
  narrow,
}: Readonly<{
  segment: FigureSegment;
  subLine: boolean;
  textValues: boolean;
  rowSize: number;
  narrow: boolean;
}>) {
  const pressable = Boolean(segment.onSelect);
  return (
    <div
      data-figure-cell=""
      data-sub-line={subLine || undefined}
      data-label-lines={narrow && !segment.labelHidden ? 2 : undefined}
      data-pressable={pressable || undefined}
      data-selected={segment.selected || undefined}
      style={cssVars({ '--row': rowSize })}
      className={cn(
        'relative min-w-0',
        pressable && !segment.selected && 'hover:overlay-hover active:overlay-pressed',
      )}
    >
      <FigureLabel segment={segment} subLine={subLine} />
      <FigureValueLine segment={segment} subLine={subLine} textValues={textValues} />
      {subLine ? <FigureSub segment={segment} /> : null}
      {pressable ? (
        <button
          type="button"
          onClick={segment.onSelect}
          aria-label={segment.actionLabel}
          aria-pressed={segment.selected}
          className="focus-ring absolute inset-0"
        />
      ) : null}
    </div>
  );
}

type FigurePart = Readonly<{ segment: FigureSegment; subLine?: boolean; textValues?: boolean }>;

function Block({ className }: Readonly<{ className: string }>) {
  return <span aria-hidden data-figure-block="" className={cn('bg-well block', className)} />;
}

function FigureLabel({ segment, subLine }: FigurePart) {
  if (segment.labelHidden) return <dt className="sr-only">{segment.label}</dt>;
  let text: ReactNode;
  if (segment.loading)
    text = (
      <>
        <span className="sr-only">{segment.label}</span>
        <Block className="h-[14px] w-24" />
      </>
    );
  else if (segment.action)
    text = (
      <span className={cn('min-w-0', pressableLayer(segment))}>
        <FigureLabelLink action={segment.action}>{segment.label}</FigureLabelLink>
      </span>
    );
  else text = <span className="min-w-0">{segment.label}</span>;
  const hint = segment.loading ? null : <FigureHint segment={segment} subLine={subLine} />;
  const Glyph = segment.icon;
  return (
    <dt className="type-caption text-ink-2 phone:block flex min-w-0 items-center gap-2">
      {Glyph ? (
        <Glyph
          aria-hidden
          className="phone:inline phone:me-2 phone:align-middle size-3.5 shrink-0"
        />
      ) : null}
      {text}
      {segment.marker || hint ? (
        <span
          className={cn(
            'phone:inline-flex phone:ms-2 phone:align-top flex shrink-0 items-center gap-2',
            pressableLayer(segment),
          )}
        >
          {segment.marker}
          {hint}
        </span>
      ) : null}
    </dt>
  );
}

function pressableLayer(segment: FigureSegment) {
  return segment.onSelect ? 'relative z-10' : undefined;
}

function FigureValueLine({ segment, subLine, textValues }: FigurePart) {
  const delta = segment.loading || !reportsChange(segment.delta) ? null : segment.delta;
  return (
    <dd
      data-figure-value=""
      className="phone:flex-wrap flex min-w-0 items-baseline gap-2 whitespace-nowrap"
    >
      <FigureValue segment={segment} textValues={textValues} />
      {delta ? <span className="type-caption-strong shrink-0">{delta}</span> : null}
      {segment.labelHidden && !segment.loading ? (
        <span className="ms-auto shrink-0 self-center">
          <FigureHint segment={segment} subLine={subLine} />
        </span>
      ) : null}
    </dd>
  );
}

function FigureSub({ segment }: FigurePart) {
  return (
    <dd className="type-caption text-ink-2 phone:whitespace-normal min-w-0 truncate">
      {segment.sub && !segment.loading ? segment.sub : ' '}
    </dd>
  );
}

function reportsChange(delta: ReactNode): boolean {
  if (delta == null || delta === false) return false;
  if (isValidElement<ComponentProps<typeof Delta>>(delta) && delta.type === Delta)
    return typeof delta.props.value === 'number' && Number.isFinite(delta.props.value);
  return true;
}

function FigureValue({ segment, textValues }: FigurePart) {
  const valueText = textRole(textValues ? 'heading' : 'figure');
  if (segment.loading)
    return (
      <span className="flex items-center self-center">
        <span className="sr-only">Loading</span>
        <Block className="h-4 w-16" />
      </span>
    );
  const { value } = segment;
  if (value == null) return <Absence state={segment.missingState} label={segment.missingLabel} />;
  if (isAbsent(value)) return <Absence state={value.absent} label={segment.missingLabel} />;
  if (typeof value === 'string' || typeof value === 'number')
    return (
      <span className={cn(valueText, 'min-w-0 truncate')} title={String(value)}>
        {String(value)}
      </span>
    );
  return <div className={cn(valueText, 'flex min-w-0 items-center gap-2')}>{value}</div>;
}

function FigureHint({ segment, subLine }: FigurePart) {
  const parts = [
    { key: 'caption', node: segment.caption },
    { key: 'sub', node: subLine ? null : segment.sub },
    { key: 'comparison', node: comparisonText(segment) },
  ].filter((part) => Boolean(part.node));
  if (!parts.length) return null;
  const name = typeof segment.label === 'string' ? segment.label : segment.key;
  return (
    <InfoHint label={`Basis of ${name}`}>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index ? ' · ' : null}
          {part.node}
        </Fragment>
      ))}
    </InfoHint>
  );
}

function comparisonText(segment: FigureSegment): ReactNode {
  const { comparison } = segment;
  if (!comparison) return null;
  return (
    <span data-figure-comparison="">
      {comparison.label}:{' '}
      <span className="tabular-nums">
        {comparison.value === null || isAbsent(comparison.value)
          ? (segment.missingLabel ??
            availabilityLabel(comparison.value?.absent ?? segment.missingState ?? 'not_measured'))
          : comparison.value}
      </span>
    </span>
  );
}

function FigureLabelLink({
  action,
  children,
}: Readonly<{ action: FigureLink; children: ReactNode }>) {
  if (action.onSelect)
    return (
      <TextLink asChild text="inherit" underline="hover" className="text-ink-2">
        <button type="button" className="text-start" onClick={action.onSelect}>
          {children}
        </button>
      </TextLink>
    );
  return (
    <TextLink
      href={action.href}
      projectId={action.projectId}
      text="inherit"
      underline="hover"
      className="text-ink-2"
    >
      {children}
    </TextLink>
  );
}
