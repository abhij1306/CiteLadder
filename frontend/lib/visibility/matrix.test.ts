import { describe, expect, it } from 'vitest';

import type { MatrixCell, VisibilityMatrix } from '@citeladder/contracts/visibility-matrix';
import { cellAt, cellReading, matrixCsvRows, type MatrixMetric } from './matrix';

const measuredCell = (over: Partial<Extract<MatrixCell, { kind: 'measured' }>>): MatrixCell => ({
  kind: 'measured',
  answers: 12,
  mention_rate: 0.25,
  share_of_voice: 0.1,
  avg_position: null,
  win_rate: null,
  sentiment: null,
  ...over,
});

const empty: MatrixCell[][] = [];
const grids: VisibilityMatrix['grids'] = {
  engine_topic: empty,
  engine_market: empty,
  engine_brand: [
    [measuredCell({ mention_rate: 0.5 }), measuredCell({ mention_rate: 0.2 })],
    [{ kind: 'not_run' }, measuredCell({ mention_rate: 0.4 })],
  ],
  topic_market: empty,
  topic_brand: empty,
  market_brand: empty,
};

describe('performance matrix cells', () => {
  it('reads the same cell whichever axis holds the rows', () => {
    const byEngine = cellAt(grids, { rows: 'engine', columns: 'brand' }, 1, 0);
    const byBrand = cellAt(grids, { rows: 'brand', columns: 'engine' }, 0, 1);
    expect([byEngine, byBrand]).toEqual([{ kind: 'not_run' }, { kind: 'not_run' }]);
    expect(cellAt(grids, { rows: 'brand', columns: 'engine' }, 1, 0)).toMatchObject({
      mention_rate: 0.2,
    });
  });

  it('keeps not run, too few and not measured apart from a value', () => {
    const fewClassified = {
      mentions: 9,
      classified: 4,
      positive: 3,
      negative: 1,
      net_sentiment: 50,
    };
    const enough = { mentions: 30, classified: 25, positive: 15, negative: 5, net_sentiment: 40 };
    expect([
      cellReading({ kind: 'not_run' }, 'mention_rate'),
      cellReading(measuredCell({ sentiment: fewClassified }), 'sentiment'),
      cellReading(measuredCell({}), 'sentiment'),
      cellReading(measuredCell({}), 'avg_position'),
      cellReading(measuredCell({ sentiment: enough }), 'sentiment'),
      cellReading(measuredCell({ avg_position: 2.345 }), 'avg_position'),
    ]).toEqual([
      { kind: 'not_run' },
      { kind: 'too_few', answers: 12 },
      { kind: 'not_measured', answers: 12 },
      { kind: 'not_measured', answers: 12 },
      { kind: 'value', value: 40, text: '+40', answers: 12 },
      { kind: 'value', value: 2.345, text: expect.stringMatching(/^2\.3/), answers: 12 },
    ]);
  });

  it('exports each cell as row, column, a number and answers', () => {
    const csv = (metric: MatrixMetric, cells: MatrixCell[][]) =>
      matrixCsvRows({
        metric,
        readings: cells.map((row) => row.map((cell) => cellReading(cell, metric))),
        rowLabels: ['ChatGPT', 'Gemini'],
        columnLabels: ['Acme', 'Globex'],
      });
    expect(
      csv('mention_rate', [
        [measuredCell({ mention_rate: 0.1234 }), { kind: 'not_run' }],
        [measuredCell({ answers: 3, mention_rate: null }), measuredCell({ mention_rate: 0 })],
      ]),
    ).toEqual([
      ['ChatGPT', 'Acme', 12.3, 12],
      ['ChatGPT', 'Globex', 'Not run yet', ''],
      ['Gemini', 'Acme', 'Not measured', 3],
      ['Gemini', 'Globex', 0, 12],
    ]);
    expect(csv('avg_position', [[measuredCell({ avg_position: 2.345 })]])).toEqual([
      ['ChatGPT', 'Acme', 2.35, 12],
    ]);
  });
});
