import type {
  MatrixAxes,
  MatrixCell,
  MatrixDimension,
  MatrixPair,
  VisibilityMatrix,
} from '@citeladder/contracts/visibility-matrix';

import { policy } from '../config.ts';
import type { PerceptionAnswer } from '../perception/metrics.ts';
import { compareText } from '../text-order.ts';
import {
  cohortMetrics,
  engineMetrics,
  metricCount,
  metricObject,
  rankingRows,
  type Metrics,
  type RankingRow,
} from './metrics.ts';
import { sentimentsOf } from './perception.ts';

const NO_MENTIONS = { mentions: 0, classified: 0, positive: 0, negative: 0, net_sentiment: null };

export type MatrixRun = {
  market: { id: string | null; label: string };
  run: {
    auditId: string;
    metrics: unknown;
    topics: ReadonlyMap<string, { name: string; metrics: unknown }>;
    answers: readonly (PerceptionAnswer & { topicId: string | null })[] | null;
  } | null;
};

export type MatrixInput = {
  runs: readonly MatrixRun[];
  strip: number;
  topicNames: ReadonlyMap<string, string>;
  filters: { engine: string | null; topic: string | null; cohort: string };
};

type Segment = { market: number; topic: string | null; engine: string | null };
type Brand = { name: string; is_brand: boolean };

const sameBrand = (row: Brand, brand: Brand) =>
  row.is_brand === brand.is_brand && (brand.is_brand || row.name === brand.name);

const byAnswers = <T extends { answers: number }>(items: T[], name: (item: T) => string) =>
  items
    .toSorted((a, b) => b.answers - a.answers || compareText(name(a), name(b)))
    .slice(0, policy.visibility.matrix_axis_limit);

function perSegment<T>(compute: (segment: Segment) => T) {
  const seen = new Map<string, { value: T }>();
  return (segment: Segment) => {
    const key = JSON.stringify([segment.market, segment.topic, segment.engine]);
    let entry = seen.get(key);
    if (!entry) {
      entry = { value: compute(segment) };
      seen.set(key, entry);
    }
    return entry.value;
  };
}

export function matrixProjection(input: MatrixInput): Omit<VisibilityMatrix, 'source_audit_ids'> {
  const { runs, strip, filters } = input;

  const measured = perSegment(
    (segment): { metrics: Metrics; answers: number; rows: RankingRow[] } | null => {
      const run = runs[segment.market]?.run;
      if (!run) return null;
      const block = segment.topic === null ? run.metrics : run.topics.get(segment.topic)?.metrics;
      if (block === undefined) return null;
      const cohort = cohortMetrics(block, filters.cohort);
      const metrics = segment.engine === null ? cohort : engineMetrics(cohort, segment.engine);
      const answers = metricCount(metrics.total_completed);
      return answers ? { metrics, answers, rows: rankingRows(metrics) } : null;
    },
  );

  const sentiments = perSegment((segment) => {
    const answers = runs[segment.market]?.run?.answers;
    return answers
      ? sentimentsOf(
          answers.filter(
            (a) =>
              (segment.engine === null || a.logicalEngine === segment.engine) &&
              (segment.topic === null || a.topicId === segment.topic),
          ),
        )
      : null;
  });

  const answersOf = (segment: Partial<Segment>) =>
    measured({ market: strip, topic: filters.topic, engine: filters.engine, ...segment })
      ?.answers ?? 0;

  function cell(segment: Segment, brand: Brand | null): MatrixCell {
    const found = measured(segment);
    if (!found) return { kind: 'not_run' };
    const target = brand ?? { name: '', is_brand: true };
    const row = found.rows.find((r) => sameBrand(r, target));
    const entities = sentiments(segment);
    return {
      kind: 'measured',
      answers: found.answers,
      mention_rate: row?.mention_rate ?? null,
      share_of_voice: row?.share_of_voice ?? null,
      avg_position: row?.avg_position ?? null,
      win_rate: row?.win_rate ?? null,
      // Perceived, and the brand was never named: no mentions, not unmeasured.
      sentiment: entities
        ? (entities.find((e) => sameBrand(e, target))?.sentiment ?? NO_MENTIONS)
        : null,
    };
  }

  const present = runs.flatMap((entry) => (entry.run ? [entry.run] : []));
  const marketIndex = runs.map((_, index) => index);
  const sumOver = (segment: Omit<Partial<Segment>, 'market'>) =>
    marketIndex.reduce((total, market) => total + answersOf({ ...segment, market }), 0);

  const engineKeys =
    filters.engine === null
      ? [
          ...new Set(
            present.flatMap((run) =>
              Object.keys(metricObject(cohortMetrics(run.metrics, filters.cohort).per_engine)),
            ),
          ),
        ]
      : [filters.engine];
  const stripRun = runs[strip]?.run;
  const topicKeys =
    filters.topic === null
      ? [
          ...new Set([
            ...input.topicNames.keys(),
            ...present.flatMap((run) => [...run.topics.keys()]),
          ]),
        ]
      : [filters.topic];
  const roster = new Map<string, Brand & { mentions: number }>();
  for (const run of [stripRun, ...present]) {
    if (!run) continue;
    for (const row of rankingRows(cohortMetrics(run.metrics, filters.cohort))) {
      const key = row.is_brand ? '' : row.name;
      if (!roster.has(key))
        roster.set(key, { name: row.name, is_brand: row.is_brand, mentions: row.mention_count });
    }
  }

  const axes: MatrixAxes = {
    engine: byAnswers(
      engineKeys.map((engine) => ({ logical_engine: engine, answers: sumOver({ engine }) })),
      (item) => item.logical_engine,
    ),
    topic: byAnswers(
      topicKeys.map((topicId) => {
        const frozen = [stripRun, ...present].find((run) => run?.topics.has(topicId))?.topics;
        const frozenName = frozen?.get(topicId)?.name ?? null;
        const name = input.topicNames.get(topicId) ?? frozenName ?? '';
        return {
          topic_id: topicId,
          name,
          renamed_from: frozenName !== null && frozenName !== name ? frozenName : null,
          answers: sumOver({ topic: topicId }),
        };
      }),
      (item) => item.name,
    ),
    market: byAnswers(
      runs.map((entry, market) => ({
        market_id: entry.market.id,
        label: entry.market.label,
        answers: answersOf({ market }),
      })),
      (item) => item.label,
    ),
    brand: [...roster.values()]
      .toSorted(
        (a, b) =>
          Number(b.is_brand) - Number(a.is_brand) ||
          b.mentions - a.mentions ||
          compareText(a.name, b.name),
      )
      .slice(0, policy.visibility.matrix_axis_limit)
      .map(({ name, is_brand }) => ({ name, is_brand, logo_url: null, website_url: null })),
  };

  const marketOf = (id: string | null) => runs.findIndex((entry) => entry.market.id === id);
  type Choice = Partial<Segment> & { brand?: Brand };
  const picks: Record<MatrixDimension, Choice[]> = {
    engine: axes.engine.map((item) => ({ engine: item.logical_engine })),
    topic: axes.topic.map((item) => ({ topic: item.topic_id })),
    market: axes.market.map((item) => ({ market: marketOf(item.market_id) })),
    brand: axes.brand.map((item) => ({ brand: item })),
  };
  const grid = (first: MatrixDimension, second: MatrixDimension) =>
    picks[first].map((a) =>
      picks[second].map((b) => {
        const { brand = null, ...segment } = { ...a, ...b };
        return cell(
          { market: strip, topic: filters.topic, engine: filters.engine, ...segment },
          brand,
        );
      }),
    );
  const grids = {
    engine_topic: grid('engine', 'topic'),
    engine_market: grid('engine', 'market'),
    engine_brand: grid('engine', 'brand'),
    topic_market: grid('topic', 'market'),
    topic_brand: grid('topic', 'brand'),
    market_brand: grid('market', 'brand'),
  } satisfies Record<MatrixPair, MatrixCell[][]>;

  const leaders = (dimension: 'engine' | 'topic' | 'market') =>
    picks[dimension].map((pick): VisibilityMatrix['rankings']['topic'][number] => {
      const segment = { market: strip, topic: filters.topic, engine: filters.engine, ...pick };
      const found = measured(segment);
      if (!found) return { kind: 'not_run' };
      return {
        kind: 'measured',
        leaders: found.rows
          .flatMap((row) =>
            row.mention_rate === null
              ? []
              : [
                  {
                    name: row.name,
                    is_brand: row.is_brand,
                    logo_url: null,
                    website_url: null,
                    mention_rate: row.mention_rate,
                  },
                ],
          )
          .toSorted((a, b) => b.mention_rate - a.mention_rate || compareText(a.name, b.name))
          .slice(0, policy.visibility.matrix_leaders),
      };
    });

  return {
    axes,
    grids,
    rankings: { engine: leaders('engine'), topic: leaders('topic'), market: leaders('market') },
  };
}
