/** Incremental traffic fold. Ordered input buffers just one revision identity. */
import { policy } from '../config.ts';
import { classifyReferralSignals } from '../referrals/classification.ts';
import { addDays } from '../referrals/projection.ts';
import { Ga4Accum, GscAccum, provenance, sourceFields, type MetricRow } from './accumulators.ts';
import { canonicalPage, hash, normalizeQuery } from './normalization.ts';
import { compareText } from '../text-order.ts';
import { landingPage } from '../integrations/host-scope.ts';
import type { NonEmpty } from '../lists.ts';

const p = policy.traffic;
type Measures = Record<string, number | null>;
type Sources = { source_metric_row_ids: string[]; source_artifact_ids: string[] };
type Stat = Sources & { metrics: Measures };
type Page = Stat & { canonical_url: string; url_hash: string };
type Query = Stat & { normalized_query: string };
type Dimension = Stat & { dimension: string; dimension_key: string; display_value: string };
type Point = { date: string; value: number | null };
export type Projection = Sources & {
  granularity: string;
  metrics: {
    totals: Measures;
    series: Record<string, Point[]>;
    provenance: Record<string, number | boolean>;
  };
  pages: Page[];
  queries: Query[];
  dimensions: Dimension[];
  dimension_counts: Record<string, number>;
};
export type ProjectionWindow = {
  windowStart: string;
  windowEnd: string;
  granularity: string;
  projectOrigin?: string | null;
  allowedHosts?: ReadonlySet<string>;
};

function bucketStart(day: string, grain: string): string {
  if (grain === 'week') return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  return grain === 'month' ? `${day.slice(0, 7)}-01` : day;
}

function startsFor(window: ProjectionWindow): string[] {
  const starts: string[] = [];
  let start = bucketStart(window.windowStart, window.granularity);
  while (start <= window.windowEnd) {
    starts.push(start);
    if (window.granularity === 'month') {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + 1);
      start = date.toISOString().slice(0, 10);
    } else start = addDays(start, window.granularity === 'week' ? 7 : 1);
  }
  return starts;
}

const identity = (row: MetricRow) =>
  JSON.stringify([row.property_ref, row.provider, row.dataset, row.date, row.dimension_key]);
const ordered = <T>(map: Map<string, T>) => [...map].sort(([a], [b]) => compareText(a, b));
function getOrAdd<T>(map: Map<string, T>, key: string, create: () => T): T {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}
function stat(gsc: GscAccum, ga4?: Ga4Accum): Stat {
  const { counts, ...sources } = sourceFields(gsc, ...(ga4 ? [ga4] : []));
  return { metrics: { ...gsc.measures(), ...ga4?.measures(), ...counts }, ...sources };
}

export class TrafficProjectionBuilder {
  private readonly window: ProjectionWindow;
  private readonly starts: string[];
  private readonly pending = new Map<string, MetricRow>();
  private orderedIdentity: string | null = null;
  private readonly totalsGsc = new GscAccum();
  private readonly totalsGa4 = new Ga4Accum();
  private readonly buckets = new Map<string, { gsc: GscAccum; ga4: Ga4Accum }>();
  private readonly pages = new Map<string, { gsc: GscAccum; ga4: Ga4Accum }>();
  private readonly queries = new Map<string, GscAccum>();
  private readonly dimensions = new Map<string, Map<string, GscAccum>>();
  private excludedHostRows = 0;
  private readonly qualities = new Map<
    string,
    { day: string; flags: string[]; revision: number | null }[]
  >();

  constructor(window: ProjectionWindow) {
    if (
      !p.TRAFFIC_SNAPSHOT_GRANULARITIES.includes(window.granularity) ||
      window.windowEnd < window.windowStart
    )
      throw new Error('Invalid traffic window');
    this.window = window;
    this.starts = startsFor(window);
    for (const start of this.starts)
      this.buckets.set(start, { gsc: new GscAccum(), ga4: new Ga4Accum() });
  }

  addBatch(rows: readonly MetricRow[], orderedByIdentity = false) {
    for (const row of rows) {
      const key = identity(row);
      if (orderedByIdentity && this.orderedIdentity !== null && this.orderedIdentity !== key)
        this.flush();
      if (orderedByIdentity) this.orderedIdentity = key;
      const previous = this.pending.get(key);
      if (!previous || row.resync_seq > previous.resync_seq) this.pending.set(key, row);
    }
  }
  partitionQuality(
    dataset: string,
    days: { day: string; flags: string[]; revision: number | null }[],
  ) {
    this.qualities.set(dataset, days);
    if (dataset !== p.DATASET_GSC_DAY_DAILY) return;
    for (const q of days) {
      const day = q.day;
      if (
        q.flags.length ||
        q.revision === null ||
        day < this.window.windowStart ||
        day > this.window.windowEnd
      )
        continue;
      this.totalsGsc.hasRows = true;
      this.buckets.get(bucketStart(day, this.window.granularity))!.gsc.hasRows = true;
    }
  }
  private measures(
    value: Measures,
    datasets: string[],
    start = this.window.windowStart,
    end = this.window.windowEnd,
  ) {
    const flagged = datasets.some((dataset) =>
      this.qualities
        .get(dataset)
        ?.some(
          (q) => q.day >= start && q.day <= end && (q.flags.length > 0 || q.revision === null),
        ),
    );
    return flagged
      ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, v === 0 ? null : v]))
      : value;
  }

  private flush() {
    const key = (row: MetricRow) => [row.date, row.dataset, row.dimension_key, row.id].join('\0');
    for (const row of [...this.pending.values()].sort((a, b) => compareText(key(a), key(b))))
      this.fold(row);
    this.pending.clear();
  }

  private page(raw: string) {
    const canonical = canonicalPage(raw, this.window.projectOrigin);
    return canonical
      ? getOrAdd(this.pages, canonical, () => ({ gsc: new GscAccum(), ga4: new Ga4Accum() }))
      : null;
  }

  private dimension(row: MetricRow, values: NonEmpty<string>) {
    const mapping: Record<string, string> = p.PERFORMANCE_DATASET_DIMENSIONS;
    const dimension = mapping[row.dataset];
    if (!dimension) return;
    let key = values[0]?.trim() ?? '';
    if (dimension === 'day') key = row.date;
    else if (dimension === 'page' || dimension === 'bing_page')
      key = canonicalPage(key, this.window.projectOrigin) ?? '';
    else if (dimension === 'query' || dimension === 'bing_query') key = normalizeQuery(key);
    if (!key) return;
    const bucket = getOrAdd(this.dimensions, dimension, () => new Map<string, GscAccum>());
    getOrAdd(bucket, key, () => new GscAccum()).add(row);
  }

  private fold(row: MetricRow) {
    if (row.date < this.window.windowStart || row.date > this.window.windowEnd) return;
    const arity: Record<string, number> = p.dimension_arity;
    const count = arity[row.dataset];
    if (count === undefined) return;
    const parts = row.dimension_key.split(p.dimension_key_separator);
    if (parts.length < count) return;
    const values: NonEmpty<string> = [
      parts.slice(0, parts.length - count + 1).join(p.dimension_key_separator),
      ...parts.slice(parts.length - count + 1),
    ];
    this.dimension(row, values);
    const bucket = this.buckets.get(bucketStart(row.date, this.window.granularity))!;
    if (row.dataset === p.DATASET_GSC_DAY_DAILY) {
      this.totalsGsc.add(row);
      bucket.gsc.add(row);
    } else if (row.dataset === p.DATASET_GSC_PAGE_DAILY) this.page(values[0])?.gsc.add(row);
    else if (row.dataset === p.DATASET_GSC_QUERY_DAILY) {
      const query = normalizeQuery(values[0]);
      if (query) getOrAdd(this.queries, query, () => new GscAccum()).add(row);
    } else this.foldGa4(row, values, bucket.ga4);
  }

  private foldGa4(row: MetricRow, values: NonEmpty<string>, bucket: Ga4Accum) {
    const ai = (source: string | undefined, medium: string | undefined) =>
      classifyReferralSignals({ utm_source: source, utm_medium: medium }) !== null;
    if (row.dataset === p.DATASET_GA4_LANDING_DAILY) {
      const hosts =
        this.window.allowedHosts ??
        new Set(this.window.projectOrigin ? [new URL(this.window.projectOrigin).hostname] : []);
      const [path, source, medium, host] = values;
      if (medium === undefined || host === undefined)
        throw new Error('Expected medium and host dimensions on a GA4 landing row');
      if (!hosts.has(host.toLowerCase())) {
        this.excludedHostRows++;
        return;
      }
      const canonical = landingPage(path, host, hosts);
      if (p.TRAFFIC_GA4_ORGANIC_MEDIUMS.includes(medium.trim().toLowerCase()) || ai(source, medium))
        if (canonical) this.page(canonical)?.ga4.add(row);
      return;
    }
    const included =
      row.dataset === p.DATASET_GA4_CHANNEL_DAILY
        ? p.TRAFFIC_GA4_ORGANIC_CHANNEL_GROUPS.includes(values[0].trim())
        : row.dataset === p.DATASET_GA4_SOURCE_MEDIUM_DAILY && ai(values[0], values[1]);
    if (included) {
      this.totalsGa4.add(row);
      bucket.add(row);
    }
  }

  build(): Projection {
    this.flush();
    this.orderedIdentity = null;
    const pages = ordered(this.pages).map(([url, a]) => ({
      canonical_url: url,
      url_hash: hash(url),
      ...stat(a.gsc, a.ga4),
      metrics: {
        ...this.measures(a.gsc.measures(), [p.DATASET_GSC_PAGE_DAILY]),
        ...this.measures(a.ga4.measures(), [p.DATASET_GA4_LANDING_DAILY]),
        ...sourceFields(a.gsc, a.ga4).counts,
      },
    }));
    const queries = ordered(this.queries).map(([query, a]) => ({
      normalized_query: query,
      ...stat(a),
      metrics: {
        ...this.measures(a.measures(), [p.DATASET_GSC_QUERY_DAILY]),
        ...sourceFields(a).counts,
      },
    }));
    const dimensions: Dimension[] = [];
    const dimensionCounts: Record<string, number> = {};
    for (const dimension of p.PERFORMANCE_TABLE_DIMENSION_ORDER) {
      const bucket = this.dimensions.get(dimension) ?? new Map<string, GscAccum>();
      dimensionCounts[dimension] = bucket.size;
      for (const [key, a] of ordered(bucket)) {
        const datasets = Object.entries(p.PERFORMANCE_DATASET_DIMENSIONS)
          .filter(([, d]) => d === dimension)
          .map(([dataset]) => dataset);
        dimensions.push({
          dimension,
          dimension_key: key,
          display_value: key,
          ...stat(a),
          metrics: { ...this.measures(a.measures(), datasets), ...sourceFields(a).counts },
        });
      }
    }
    const ga4Datasets = [p.DATASET_GA4_CHANNEL_DAILY, p.DATASET_GA4_SOURCE_MEDIUM_DAILY];
    const totals = {
      ...this.measures(this.totalsGsc.measures(true), [p.DATASET_GSC_DAY_DAILY]),
      ...this.measures(this.totalsGa4.measures(), ga4Datasets),
    };
    const series: Record<string, Point[]> = Object.fromEntries(
      Object.keys(totals).map((key) => [key, []]),
    );
    for (const start of this.starts) {
      const bucket = this.buckets.get(start)!;
      const end = this.starts[this.starts.indexOf(start) + 1]
        ? addDays(this.starts[this.starts.indexOf(start) + 1]!, -1)
        : this.window.windowEnd;
      const measures = {
        ...this.measures(bucket.gsc.measures(true), [p.DATASET_GSC_DAY_DAILY], start, end),
        ...this.measures(bucket.ga4.measures(), ga4Datasets, start, end),
      };
      for (const [key, value] of Object.entries(measures))
        series[key]!.push({
          date: start < this.window.windowStart ? this.window.windowStart : start,
          value,
        });
    }
    const stats = [...pages, ...queries, ...dimensions];
    const rows = provenance([
      ...provenance(this.totalsGsc.rowIds).ids,
      ...provenance(this.totalsGa4.rowIds).ids,
      ...stats.flatMap((row) => row.source_metric_row_ids),
    ]);
    const artifacts = provenance([
      ...provenance(this.totalsGsc.artifactIds).ids,
      ...provenance(this.totalsGa4.artifactIds).ids,
      ...stats.flatMap((row) => row.source_artifact_ids),
    ]);
    return {
      granularity: this.window.granularity,
      metrics: {
        totals,
        series,
        provenance: {
          id_limit: p.TRAFFIC_PROVENANCE_ID_LIMIT,
          excluded_host_rows: this.excludedHostRows,
          metric_row_total: rows.total,
          artifact_total: artifacts.total,
          metric_rows_sampled: rows.ids.length < rows.total,
          artifacts_sampled: artifacts.ids.length < artifacts.total,
          sampled_stat_rows: stats.filter(
            (row) =>
              'source_metric_row_count' in row.metrics || 'source_artifact_count' in row.metrics,
          ).length,
        },
      },
      pages,
      queries,
      dimensions,
      dimension_counts: dimensionCounts,
      source_metric_row_ids: rows.ids,
      source_artifact_ids: artifacts.ids,
    };
  }
}

export function buildTrafficProjection(
  input: ProjectionWindow & { rows: MetricRow[] },
): Projection {
  const builder = new TrafficProjectionBuilder(input);
  builder.addBatch(input.rows);
  return builder.build();
}
