import { words } from '@/lib/ai-traffic/vocabulary';
import { formatDisplayDate, formatWindowDate } from '@/lib/format';

/** A provider figure, or null when the provider did not report one. */
export function searchNumber(value: unknown, maximumFractionDigits = 0): string | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean')
    return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return new Intl.NumberFormat('en', { maximumFractionDigits }).format(number);
}

type RunCost = {
  confirmed_at: string | null;
  estimated_cost_usd: string | null;
  provider_reported_cost_usd: string | null;
};

/** The analysis's estimate at the DataForSEO price, billed to the workspace's own account. */
export function runEstimate(run: RunCost): string {
  return '$' + estimateUsd(run.estimated_cost_usd ?? '0');
}

/** What the analysis was charged; unconfirmed work never was, and an open charge is pending. */
export function reportedCost(run: RunCost): string {
  if (!run.confirmed_at) return 'Not charged';
  if (run.provider_reported_cost_usd === null) return 'Unresolved';
  return '$' + (searchNumber(run.provider_reported_cost_usd, 6) ?? run.provider_reported_cost_usd);
}

/** An estimate, rounded up to a hundredth of a cent so it never understates the ceiling. */
export function estimateUsd(value: string): string {
  if (!/^\d+(\.\d+)?$/u.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? (Math.ceil(number * 10000) / 10000).toFixed(4) : value;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const units = BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4));
  const rounded = units + (/[1-9]/.test(fraction.slice(4)) ? 1n : 0n);
  return `${rounded / 10000n}.${String(rounded % 10000n).padStart(4, '0')}`;
}

/** How many results a comparison found; an absent dataset was never fetched. */
export function datasetCount(
  dataset: { provider_total: number | null; unique_rows_saved: number } | undefined,
): string {
  if (!dataset) return 'Not fetched';
  if (dataset.provider_total !== null)
    return searchNumber(dataset.provider_total) ?? String(dataset.provider_total);
  return dataset.unique_rows_saved
    ? `${searchNumber(dataset.unique_rows_saved)} saved`
    : 'No results';
}

/** The referring-domain lists citations can be matched against: one per researched website. */
export const referringLists = <T extends { dataset_kind: string; unique_rows_saved: number }>(
  datasets: readonly T[],
) =>
  datasets.filter(
    (dataset) => dataset.dataset_kind === 'referring_domains' && dataset.unique_rows_saved > 0,
  );

/** Internal identities and nested provider metadata never reach the evidence list. */
const HIDDEN_FIELDS = new Set([
  'id',
  'dataset_id',
  'call_id',
  'row_kind',
  'auxiliary',
  'provider_row_key',
  'citation_id',
  'audit_id',
  'artifact_id',
  'analyzer_version',
  'action_id',
]);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

export type EvidenceField = { key: string; label: string; value: string | null };

/** A saved row as readable label/value pairs; null is a value the provider did not report. */
export function evidenceFields(
  row: Readonly<Record<string, unknown>>,
  labels: Readonly<Record<string, string>>,
  timeZone: string,
): EvidenceField[] {
  return Object.entries(row).flatMap(([key, value]) => {
    if (HIDDEN_FIELDS.has(key)) return [];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return [];
    const label = labels[key] ?? words(key);
    return [{ key, label, value: evidenceValue(value, timeZone) }];
  });
}

/** A list of plain values joined; a list holding objects is not shown as text. */
const listText = (value: unknown[]) =>
  value.length && value.every((item) => typeof item !== 'object') ? value.join(', ') : null;

function evidenceValue(value: unknown, timeZone: string): string | null {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return searchNumber(value, 4);
  if (Array.isArray(value)) return listText(value);
  // Nested provider objects are summarised elsewhere, never printed as text.
  if (typeof value !== 'string' || !value) return null;
  if (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) return value;
  // A calendar date is a day, not an instant: zoning it would show the day
  // before west of UTC.
  return DATE_ONLY.test(value) ? formatWindowDate(value) : formatDisplayDate(value, timeZone);
}
