import { z } from 'zod';

import type { PerformanceGranularity } from '@/lib/api/performance';
import {
  setUrlParams,
  stringUrlCodec,
  useUrlState,
  type UrlCodec,
} from '@/lib/navigation/url-state';
import {
  COMPARE_OPTIONS,
  DIMENSION_TABS,
  GRANULARITY_OPTIONS,
  INITIAL_GRANULARITY,
  INITIAL_SELECTION,
  METRIC_CARDS,
  RANGE_OPTIONS,
  type PerformanceMetricKey,
  type RangeSelection,
  type SearchConsoleDimension,
} from '@/lib/performance/performance';

const DEFAULT_METRICS: readonly PerformanceMetricKey[] = ['clicks', 'impressions'];
const METRIC_KEYS = METRIC_CARDS.map((card) => card.key);

const rangeCodec = stringUrlCodec(
  RANGE_OPTIONS.map((option) => option.value),
  INITIAL_SELECTION.range,
);
const compareCodec = stringUrlCodec(
  COMPARE_OPTIONS.map((option) => option.value),
  INITIAL_SELECTION.compare,
);
const granularityCodec = stringUrlCodec(
  GRANULARITY_OPTIONS.map((option) => option.value),
  INITIAL_GRANULARITY,
);
const dimensionCodec = stringUrlCodec<SearchConsoleDimension>(
  DIMENSION_TABS.map((tab) => tab.value),
  'query',
);

const calendarDate = z.iso.date();

const dateCodec: UrlCodec<string> = {
  parse: (raw) => {
    const parsed = calendarDate.safeParse(raw);
    return parsed.success ? parsed.data : '';
  },
  serialize: (value) => value || null,
};

const metricsCodec: UrlCodec<readonly PerformanceMetricKey[]> = {
  parse: (raw) => {
    const keys = METRIC_KEYS.filter((key) => raw?.split(',').includes(key));
    return keys.length > 0 ? keys : DEFAULT_METRICS;
  },
  serialize: (keys) => {
    const ordered = METRIC_KEYS.filter((key) => keys.includes(key));
    const landing = ordered.join(',') === DEFAULT_METRICS.join(',');
    return landing ? null : ordered.join(',');
  },
};

export type PerformanceSelection = {
  selection: RangeSelection;
  setSelection: (selection: RangeSelection) => void;
  granularity: PerformanceGranularity;
  setGranularity: (granularity: PerformanceGranularity) => void;
  dimension: SearchConsoleDimension;
  setDimension: (dimension: SearchConsoleDimension) => void;
  activeMetrics: ReadonlySet<PerformanceMetricKey>;
  toggleMetric: (key: PerformanceMetricKey) => void;
  reset: () => void;
};

function selectionParams(selection: RangeSelection): Record<string, string | null> {
  return {
    range: rangeCodec.serialize(selection.range),
    from: dateCodec.serialize(selection.from),
    to: dateCodec.serialize(selection.to),
    compare: compareCodec.serialize(selection.compare),
    compare_from: dateCodec.serialize(selection.compareFrom),
    compare_to: dateCodec.serialize(selection.compareTo),
  };
}

export function usePerformanceSelection(): PerformanceSelection {
  const [range] = useUrlState('range', rangeCodec);
  const [from] = useUrlState('from', dateCodec);
  const [to] = useUrlState('to', dateCodec);
  const [compare] = useUrlState('compare', compareCodec);
  const [compareFrom] = useUrlState('compare_from', dateCodec);
  const [compareTo] = useUrlState('compare_to', dateCodec);
  const [granularity, setGranularity] = useUrlState('granularity', granularityCodec);
  const [dimension, setDimension] = useUrlState('dimension', dimensionCodec);
  const [metrics, setMetrics] = useUrlState('metrics', metricsCodec);

  const toggleMetric = (key: PerformanceMetricKey) => {
    if (!metrics.includes(key)) setMetrics([...metrics, key]);
    else if (metrics.length > 1) setMetrics(metrics.filter((metric) => metric !== key));
  };

  const reset = () =>
    setUrlParams({
      ...selectionParams(INITIAL_SELECTION),
      granularity: null,
      dimension: null,
      metrics: null,
    });

  return {
    selection: { range, from, to, compare, compareFrom, compareTo },
    setSelection: (next) => setUrlParams(selectionParams(next)),
    granularity,
    setGranularity,
    dimension,
    setDimension,
    activeMetrics: new Set(metrics),
    toggleMetric,
    reset,
  };
}
