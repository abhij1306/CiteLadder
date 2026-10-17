'use client';

import { useState } from 'react';

import type { PerformanceGranularity } from '@/lib/api/performance';
import {
  INITIAL_GRANULARITY,
  INITIAL_SELECTION,
  type PerformanceMetricKey,
  type RangeSelection,
  type SearchConsoleDimension,
} from '@/lib/performance/performance';

/**
 * Everything the reader has CHOSEN on the Performance surface: the range and
 * its comparison, the chart's bucket size, the open breakdown, and which
 * metrics are drawn.
 *
 * One owner for the whole selection, because these move together: Reset
 * returns all of them to the landing state at once, and leaving that spread
 * across the screen component invited a reset that cleared four of the five.
 */

/** The two metrics the surface lands on. */
const DEFAULT_METRICS: readonly PerformanceMetricKey[] = ['clicks', 'impressions'];

export type PerformanceSelection = {
  selection: RangeSelection;
  setSelection: (selection: RangeSelection) => void;
  granularity: PerformanceGranularity;
  setGranularity: (granularity: PerformanceGranularity) => void;
  /** The open Search Console tab. Bing's panel owns its own tab state. */
  dimension: SearchConsoleDimension;
  setDimension: (dimension: SearchConsoleDimension) => void;
  activeMetrics: ReadonlySet<PerformanceMetricKey>;
  toggleMetric: (key: PerformanceMetricKey) => void;
  reset: () => void;
};

export function usePerformanceSelection(): PerformanceSelection {
  const [selection, setSelection] = useState<RangeSelection>(INITIAL_SELECTION);
  const [dimension, setDimension] = useState<SearchConsoleDimension>('query');
  const [granularity, setGranularity] = useState<PerformanceGranularity>(INITIAL_GRANULARITY);
  const [activeMetrics, setActiveMetrics] = useState<ReadonlySet<PerformanceMetricKey>>(
    () => new Set<PerformanceMetricKey>(DEFAULT_METRICS),
  );

  const toggleMetric = (key: PerformanceMetricKey) =>
    setActiveMetrics((current) => {
      const next = new Set(current);
      // The chart must always draw something, so the last selected metric
      // cannot be turned off.
      if (!next.has(key)) {
        next.add(key);
        return next;
      }
      if (next.size === 1) return current;
      next.delete(key);
      return next;
    });

  // Reset returns the surface to its landing state: the newest synced
  // window, daily buckets, no comparison, the first tab, and the two default
  // metrics. It is offered only while a comparison is active — that is the
  // state it exists to clear.
  const reset = () => {
    setSelection(INITIAL_SELECTION);
    setGranularity(INITIAL_GRANULARITY);
    setDimension('query');
    setActiveMetrics(new Set<PerformanceMetricKey>(DEFAULT_METRICS));
  };

  return {
    selection,
    setSelection,
    granularity,
    setGranularity,
    dimension,
    setDimension,
    activeMetrics,
    toggleMetric,
    reset,
  };
}
