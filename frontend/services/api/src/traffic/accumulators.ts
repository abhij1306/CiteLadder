import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';

export type MetricRow = {
  id: string;
  property_ref: string;
  provider: string;
  dataset: string;
  date: string;
  dimension_key: string;
  metrics: Record<string, unknown> | null;
  source_artifact_id: string;
  resync_seq: number;
  importer_version?: string;
};

/** Invalid provider numbers do not become observations. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricCount(row: MetricRow, key: string): number {
  return Math.trunc(numberOrNull(row.metrics?.[key]) ?? 0);
}

export function provenance(ids: Iterable<string>) {
  const all = [...new Set(ids)].sort(compareText);
  return { ids: all.slice(0, policy.traffic.TRAFFIC_PROVENANCE_ID_LIMIT), total: all.length };
}

export class GscAccum {
  impressions = 0;
  clicks = 0;
  weighted = 0;
  positionImpressions = 0;
  hasRows = false;
  rowIds = new Set<string>();
  artifactIds = new Set<string>();

  add(row: MetricRow) {
    this.hasRows = true;
    const impressions = metricCount(row, 'impressions');
    this.impressions += impressions;
    this.clicks += metricCount(row, 'clicks');
    const position = numberOrNull(row.metrics?.position);
    if (position !== null) {
      this.weighted += position * impressions;
      this.positionImpressions += impressions;
    }
    this.rowIds.add(row.id);
    this.artifactIds.add(row.source_artifact_id);
  }

  measures(observed = false) {
    return {
      impressions: observed && !this.hasRows ? null : this.impressions,
      clicks: observed && !this.hasRows ? null : this.clicks,
      ctr: this.impressions === 0 ? null : this.clicks / this.impressions,
      position: this.positionImpressions === 0 ? null : this.weighted / this.positionImpressions,
    };
  }
}

export class Ga4Accum {
  sessions = 0;
  engaged = 0;
  events = 0;
  hasRows = false;
  rowIds = new Set<string>();
  artifactIds = new Set<string>();

  add(row: MetricRow) {
    this.hasRows = true;
    this.sessions += metricCount(row, 'sessions');
    this.engaged += metricCount(row, 'engagedSessions');
    this.events += numberOrNull(row.metrics?.keyEvents) ?? 0;
    this.rowIds.add(row.id);
    this.artifactIds.add(row.source_artifact_id);
  }

  measures() {
    return {
      sessions: this.hasRows ? this.sessions : null,
      engaged_sessions: this.hasRows ? this.engaged : null,
      key_events: this.hasRows ? this.events : null,
    };
  }
}

export function sourceFields(...accums: (GscAccum | Ga4Accum)[]) {
  const rows = provenance(accums.flatMap((a) => [...a.rowIds]));
  const artifacts = provenance(accums.flatMap((a) => [...a.artifactIds]));
  const counts: Record<string, number> = {};
  if (rows.ids.length < rows.total) counts.source_metric_row_count = rows.total;
  if (artifacts.ids.length < artifacts.total) counts.source_artifact_count = artifacts.total;
  return { source_metric_row_ids: rows.ids, source_artifact_ids: artifacts.ids, counts };
}
