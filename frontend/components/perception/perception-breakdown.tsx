import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

import { AttributeTable } from '@/components/perception/attribute-table';
import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { TableCell, TableRow, UrlText } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useEngineCatalog } from '@/lib/providers/engines';
import { breakdownRow, SMALL_SAMPLE, type SampleShare } from '@/lib/visibility/perception';

type Category = PerceptionResponse['entities'][number]['categories'][number];
type View = 'attribute' | 'topic' | 'engine' | 'source';
type Segment = 'topic' | 'engine';

const VIEW_LABEL: Record<View, string> = {
  attribute: 'By attribute',
  topic: 'By topic',
  engine: 'By engine',
  source: 'By source',
};

const VIEWS = ['attribute', 'topic', 'engine', 'source'] as const satisfies readonly View[];

const VIEW_CODEC = stringUrlCodec<View>(VIEWS, 'attribute');

function shownViews(
  data: Pick<PerceptionResponse, 'topics' | 'engines' | 'drivers'>,
  categories: readonly Category[],
): View[] {
  const has: Record<View, boolean> = {
    attribute: categories.length > 0,
    topic: data.topics.length > 0,
    engine: data.engines.length > 0,
    source: data.drivers.length > 0,
  };
  return VIEWS.filter((view) => has[view]);
}

export function PerceptionBreakdown({
  data,
  categories,
}: Readonly<{ data: PerceptionResponse; categories: readonly Category[] }>) {
  const [requested, setView] = useUrlState('breakdown', VIEW_CODEC, { history: 'replace' });
  const views = shownViews(data, categories);
  const view = views.includes(requested) ? requested : views[0];
  if (!view) return null;
  return (
    <Stack as="section" aria-label="Breakdown" gap="item">
      <SegmentedControl
        value={view}
        onChange={setView}
        ariaLabel="Break perception down"
        options={views.map((value) => ({ value, label: VIEW_LABEL[value] }))}
        className="justify-self-start"
      />
      <BreakdownView view={view} data={data} categories={categories} />
    </Stack>
  );
}

function BreakdownView({
  view,
  data,
  categories,
}: Readonly<{ view: View; data: PerceptionResponse; categories: readonly Category[] }>) {
  switch (view) {
    case 'attribute':
      return <AttributeTable categories={categories} />;
    case 'topic':
    case 'engine':
      return <SegmentTable segment={view} rows={data[`${view}s`]} />;
    case 'source':
      return <SourceTable drivers={data.drivers} />;
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

function segmentColumns(segment: Segment): readonly DataTableColumn[] {
  return [
    { key: 'segment', label: segment === 'engine' ? 'Engine' : 'Topic' },
    { key: 'classified', label: 'Classified', width: 'metric', kind: 'number' },
    { key: 'positive', label: 'Positive', width: 'metric', kind: 'number' },
    { key: 'neutral', label: 'Neutral', width: 'metric', kind: 'number', priority: 'low' },
    { key: 'negative', label: 'Negative', width: 'metric', kind: 'number' },
    { key: 'net', label: 'Net sentiment', width: 'metric', kind: 'number', priority: 'low' },
  ];
}

function ShareCell({ share }: Readonly<{ share: SampleShare }>) {
  return <TableCell numeric>{share.kind === 'empty' ? <Absence /> : share.text}</TableCell>;
}

function SegmentTable({
  segment,
  rows,
}: Readonly<{ segment: Segment; rows: PerceptionResponse['topics'] }>) {
  const { label: engineLabel } = useEngineCatalog();
  return (
    <DataTable label={`Perception by ${segment}`} columns={segmentColumns(segment)}>
      {rows.map((row) => {
        const cells = breakdownRow(row);
        return (
          <TableRow key={row.key}>
            <TableCell>
              <span className="inline-flex items-center gap-2">
                {segment === 'engine' ? engineLabel(row.key) : row.label}
                {cells.small ? <Tag>{SMALL_SAMPLE}</Tag> : null}
              </span>
            </TableCell>
            <TableCell numeric>
              {cells.classified} / {cells.mentions}
            </TableCell>
            <ShareCell share={cells.positive} />
            <ShareCell share={cells.neutral} />
            <ShareCell share={cells.negative} />
            <TableCell numeric>
              {cells.net.kind === 'value' ? cells.net.text : <Absence state="too_few" />}
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function SourceTable({ drivers }: Readonly<{ drivers: PerceptionResponse['drivers'] }>) {
  return (
    <DataTable
      label="Sources cited alongside criticism"
      columns={[
        { key: 'domain', label: 'Source' },
        { key: 'answers', label: 'Negative answers', width: 'metric', kind: 'number' },
        { key: 'example', label: 'Example page', kind: 'url' },
      ]}
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
