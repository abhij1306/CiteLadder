import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';
import { Fragment, type ComponentProps, type ReactNode } from 'react';

import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useShownSpan } from '@/components/ui/data-table-fit';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { CellMeter } from '@/components/ui/meter';
import { Pressable } from '@/components/ui/pressable';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableRow, UrlText } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { QuoteLink } from '@/components/visibility/visibility-perception';
import { ChevronDown, ChevronRight } from '@/lib/icons';
import { PERCEPTION_MIN_CLASSIFIED } from '@/lib/config/visibility';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useEngineCatalog } from '@/lib/providers/engines';
import { formatPercent, percentText } from '@/lib/format';
import { breakdownRow, formatNet, themeNegativeShare } from '@/lib/visibility/perception';

type View = 'theme' | 'topic' | 'engine' | 'prompt' | 'source';
type Segment = Exclude<View, 'theme' | 'source'>;

const VIEWS = [
  { value: 'theme', label: 'By theme' },
  { value: 'topic', label: 'By topic' },
  { value: 'engine', label: 'By engine' },
  { value: 'prompt', label: 'By prompt' },
  { value: 'source', label: 'By source' },
] as const satisfies readonly { value: View; label: string }[];

const VIEW_CODEC = stringUrlCodec<View>(
  VIEWS.map((item) => item.value),
  'theme',
);

const SEGMENT_HEAD: Record<Segment, string> = {
  topic: 'Topic',
  engine: 'Engine',
  prompt: 'Prompt',
};

function noneHere(message: string): ComponentProps<typeof DataTable>['state'] {
  return { kind: 'empty', inline: true, message };
}

export function PerceptionBreakdown({ data }: Readonly<{ data: PerceptionResponse }>) {
  const [view, setView] = useUrlState('breakdown', VIEW_CODEC, { history: 'replace' });
  const switcher = (
    <SegmentedControl
      value={view}
      onChange={setView}
      options={VIEWS}
      ariaLabel="Break perception down"
    />
  );
  switch (view) {
    case 'theme':
      return <ThemeTable themes={data.themes} actions={switcher} />;
    case 'source':
      return <SourceTable drivers={data.drivers} actions={switcher} />;
    case 'topic':
    case 'engine':
    case 'prompt':
      return <SegmentTable segment={view} rows={data[`${view}s`]} actions={switcher} />;
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

const THEME_COLUMNS: readonly DataTableColumn[] = [
  { key: 'theme', label: 'Theme' },
  { key: 'negative', label: 'Negative', width: 'figure', kind: 'number' },
  { key: 'positive', label: 'Positive', width: 'figure', kind: 'number' },
  { key: 'share', label: 'Share negative', width: 'figure', kind: 'number' },
  { key: 'bar', label: 'Negative vs positive', width: 'category', priority: 'low' },
];

function ThemeTable({
  themes,
  actions,
}: Readonly<{ themes: PerceptionResponse['themes']; actions: ReactNode }>) {
  const [open, setOpen] = useUrlState('theme', optionalStringUrlCodec, { history: 'replace' });
  const { label: engineLabel } = useEngineCatalog();
  return (
    <DataTable
      title="Breakdown"
      actions={actions}
      label="Perception by theme"
      columns={THEME_COLUMNS}
      state={themes.length ? undefined : noneHere('No themes in these answers.')}
    >
      {themes.map((theme) => {
        const expanded = open === theme.theme;
        const share = themeNegativeShare(theme);
        const shown = share === null ? null : percentText(share);
        return (
          <Fragment key={theme.theme}>
            <TableRow>
              <TableCell>
                <Pressable
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : theme.theme)}
                  className="w-auto"
                >
                  <Inline as="span">
                    <Icon icon={expanded ? ChevronDown : ChevronRight} className="text-ink-2" />
                    {theme.theme}
                  </Inline>
                </Pressable>
              </TableCell>
              <TableCell numeric>{theme.negative}</TableCell>
              <TableCell numeric>{theme.positive}</TableCell>
              <TableCell numeric>{shown ?? <Absence state="too_few" />}</TableCell>
              <TableCell>
                {share === null ? null : (
                  <CellMeter
                    label={`${theme.theme}: negative share`}
                    value={share * 100}
                    max={100}
                    valueText={shown ?? ''}
                    tone="negative"
                  />
                )}
              </TableCell>
            </TableRow>
            {expanded
              ? theme.quotes.map((quote) => (
                  <QuoteRow
                    key={`${quote.execution_id}:${quote.text}`}
                    quote={quote}
                    engine={engineLabel(quote.logical_engine)}
                  />
                ))
              : null}
          </Fragment>
        );
      })}
    </DataTable>
  );
}

function QuoteRow({
  quote,
  engine,
}: Readonly<{ quote: PerceptionResponse['themes'][number]['quotes'][number]; engine: string }>) {
  const span = useShownSpan(['theme', 'negative', 'bar']) - 1;
  return (
    <TableRow>
      <TableCell nested colSpan={span}>
        <QuoteLink quote={quote} />
      </TableCell>
      <TableCell>
        <StatusMark variant="sentiment" value={quote.polarity}>
          {quote.polarity === 'negative' ? 'Negative' : 'Positive'}
        </StatusMark>
      </TableCell>
      <TableCell>{engine}</TableCell>
      <TableCell>{quote.prompt}</TableCell>
    </TableRow>
  );
}

function segmentColumns(segment: Segment): readonly DataTableColumn[] {
  return [
    { key: 'segment', label: SEGMENT_HEAD[segment] },
    { key: 'classified', label: 'Classified', width: 'metric', kind: 'number' },
    { key: 'positive', label: 'Positive', width: 'figure', kind: 'number' },
    { key: 'neutral', label: 'Neutral', width: 'figure', kind: 'number' },
    { key: 'negative', label: 'Negative', width: 'figure', kind: 'number' },
    { key: 'net', label: 'Net sentiment', width: 'metric', kind: 'number' },
  ];
}

function SegmentTable({
  segment,
  rows,
  actions,
}: Readonly<{
  segment: Segment;
  rows: PerceptionResponse['topics'];
  actions: ReactNode;
}>) {
  const { label: engineLabel } = useEngineCatalog();
  const name = (row: PerceptionResponse['topics'][number]) =>
    segment === 'engine' ? engineLabel(row.key) : row.label;
  return (
    <DataTable
      title="Breakdown"
      actions={actions}
      label={`Perception by ${segment}`}
      columns={segmentColumns(segment)}
      state={rows.length ? undefined : noneHere('No answers in this selection named you.')}
    >
      {rows.map((row) => {
        const cells = breakdownRow(row, PERCEPTION_MIN_CLASSIFIED);
        return (
          <TableRow key={row.key}>
            <TableCell>{name(row)}</TableCell>
            <TableCell numeric>
              {cells.classified} of {cells.mentions}
            </TableCell>
            {cells.kind === 'too_few' ? (
              <TableCell numeric colSpan={4} className="text-ink-2">
                Too few classified ({cells.classified} of the {cells.needed} needed)
              </TableCell>
            ) : (
              <>
                <TableCell numeric>{formatPercent(cells.positive)}</TableCell>
                <TableCell numeric>{formatPercent(cells.neutral)}</TableCell>
                <TableCell numeric>{formatPercent(cells.negative)}</TableCell>
                <TableCell numeric>{formatNet(cells.net) ?? <Absence />}</TableCell>
              </>
            )}
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function SourceTable({
  drivers,
  actions,
}: Readonly<{ drivers: PerceptionResponse['drivers']; actions: ReactNode }>) {
  return (
    <DataTable
      title="Breakdown"
      actions={actions}
      label="Sources cited alongside criticism"
      columns={[
        { key: 'domain', label: 'Domain' },
        { key: 'answers', label: 'Answers with criticism', width: 'metric', kind: 'number' },
        { key: 'example', label: 'Example', kind: 'url' },
      ]}
      state={drivers.length ? undefined : noneHere('No sources cited alongside criticism.')}
    >
      {drivers.map((driver) => (
        <TableRow key={driver.domain}>
          <TableCell>{driver.domain}</TableCell>
          <TableCell numeric>{driver.answers}</TableCell>
          <TableCell>
            {driver.example_url ? <UrlText url={driver.example_url} /> : <Absence />}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
