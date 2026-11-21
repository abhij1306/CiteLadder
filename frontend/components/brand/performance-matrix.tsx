import type { UseQueryResult } from '@tanstack/react-query';

import type { Visibility } from '@citeladder/contracts';
import type { MatrixDimension, VisibilityMatrix } from '@citeladder/contracts/visibility-matrix';
import { Button } from '@/components/ui/button';
import {
  GridTableSkeleton,
  HeatScale,
  HeatTable,
  type HeatValue,
} from '@/components/ui/heat-table';
import { Inline, Stack } from '@/components/ui/layout';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { StateBlock } from '@/components/ui/state-block';
import { SegmentedControl } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { downloadCsv } from '@/lib/csv/download';
import { MATRIX_DIMENSIONS, MATRIX_METRICS } from '@/lib/config/visibility';
import { pluralCount } from '@/lib/format';
import { setUrlParams, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import {
  cellAt,
  cellReading,
  heatScale,
  matrixCsvMetricHeader,
  matrixCsvRows,
  READING_LABELS,
  type CellReading,
} from '@/lib/visibility/matrix';
import { AxisLabel, matrixBodyState, pendingAxisLength, useAxisText } from './matrix-parts';

const today = () => new Date().toISOString().slice(0, 10);

const DIMENSIONS = MATRIX_DIMENSIONS.map((option) => option.value);
const metricCodec = stringUrlCodec(
  MATRIX_METRICS.map((item) => item.value),
  'mention_rate',
);
const rowsCodec = stringUrlCodec(DIMENSIONS, 'engine');
const columnsCodec = stringUrlCodec(DIMENSIONS, 'brand');

function distinctColumns(rows: MatrixDimension, columns: MatrixDimension): MatrixDimension {
  if (columns !== rows) return columns;
  return rows === 'brand' ? 'engine' : 'brand';
}

const dimensionLabel = (dimension: MatrixDimension) =>
  MATRIX_DIMENSIONS.find((option) => option.value === dimension)?.label ?? dimension;

export function PerformanceMatrix({
  query,
  selected,
}: Readonly<{ query: UseQueryResult<VisibilityMatrix>; selected: Visibility }>) {
  const [metric, setMetric] = useUrlState('matrix_metric', metricCodec);
  const [rows, setRows] = useUrlState('matrix_rows', rowsCodec);
  const [linkedColumns, setColumns] = useUrlState('matrix_columns', columnsCodec);
  const columns = distinctColumns(rows, linkedColumns);
  const axisText = useAxisText();
  const data = query.data;
  const rowText = data ? axisText(data.axes, rows) : [];
  const columnText = data ? axisText(data.axes, columns) : [];
  const readings: CellReading[][] = data
    ? rowText.map((_, i) =>
        columnText.map((_, j) => cellReading(cellAt(data.grids, { rows, columns }, i, j), metric)),
      )
    : [];
  const place = heatScale(
    readings.flat().flatMap((r) => (r.kind === 'value' ? [r.value] : [])),
    metric,
  );
  const options = (skip: MatrixDimension) =>
    MATRIX_DIMENSIONS.filter((option) => option.value !== skip);
  const exportCsv = () =>
    downloadCsv(
      `citeladder-matrix-${rows}-${columns}-${today()}`,
      [
        dimensionLabel(rows),
        dimensionLabel(columns),
        matrixCsvMetricHeader(
          metric,
          MATRIX_METRICS.find((item) => item.value === metric)?.label ?? metric,
        ),
        'Answers',
      ],
      matrixCsvRows({ readings, rowLabels: rowText, columnLabels: columnText, metric }),
    );
  const heatValue = (reading: CellReading): HeatValue =>
    reading.kind === 'value'
      ? {
          kind: 'value',
          text: reading.text,
          detail: pluralCount(reading.answers, 'answer'),
          tint: place(reading.value),
        }
      : {
          kind: 'void',
          state: reading.kind,
          label: READING_LABELS[reading.kind],
        };

  function body() {
    const state = matrixBodyState(
      query,
      'matrix',
      <GridTableSkeleton
        label="Loading the matrix…"
        variant="heat"
        rows={pendingAxisLength(selected, rows)}
        columns={pendingAxisLength(selected, columns)}
      />,
    );
    if (state || !data) return state;
    if (!rowText.length || !columnText.length)
      return (
        <StateBlock
          kind="empty"
          inline
          message="Nothing to compare on these axes in this selection."
        />
      );
    return (
      <HeatTable
        labelledBy="insights-matrix"
        corner={dimensionLabel(rows)}
        columns={columnText.map((text, j) => ({
          key: `${columns}-${j}`,
          header: <AxisLabel axes={data.axes} dimension={columns} index={j} text={text} />,
        }))}
        rows={rowText.map((text, i) => ({
          key: `${rows}-${i}`,
          header: <AxisLabel axes={data.axes} dimension={rows} index={i} text={text} />,
          cells: (readings[i] ?? []).map(heatValue),
        }))}
      />
    );
  }

  return (
    <Section aria-labelledby="insights-matrix">
      <SectionHeader>
        <SectionTitle id="insights-matrix">Performance matrix</SectionTitle>
      </SectionHeader>
      <Stack>
        <Inline className="flex-wrap">
          <SegmentedControl
            ariaLabel="Matrix metric"
            value={metric}
            options={MATRIX_METRICS}
            onChange={setMetric}
          />
          <span className="flex-1" />
          <Select
            ariaLabel="Rows"
            value={rows}
            options={options(columns)}
            onValueChange={setRows}
          />
          <span className={textRole('caption')}>vs</span>
          <Select
            ariaLabel="Columns"
            value={columns}
            options={options(rows)}
            onValueChange={setColumns}
          />
          <Button
            onClick={() =>
              setUrlParams({
                matrix_rows: rowsCodec.serialize(columns),
                matrix_columns: columnsCodec.serialize(rows),
              })
            }
          >
            Switch axis
          </Button>
          <Button onClick={exportCsv} disabled={!readings.length}>
            Export CSV
          </Button>
        </Inline>
        {body()}
        <HeatScale note="Up to 10 per axis" />
      </Stack>
    </Section>
  );
}
