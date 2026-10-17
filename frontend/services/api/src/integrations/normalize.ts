import { providerNumber } from './client.ts';
import { integrationPolicy, type Dataset } from './config.ts';

function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const date = /^\d{8}$/u.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? date
    : null;
}
function values(row: Record<string, unknown>): unknown[] {
  return Array.isArray(row.keys) ? row.keys : [];
}
/**
 * Parse one provider page into metric rows. `invalid` counts rows that could not
 * be parsed; a valid row dated outside the window is dropped without counting,
 * because Bing always returns its whole history whatever window is requested.
 */
export function normalizedRows(
  provider: string,
  dataset: string,
  template: Dataset,
  payload: Record<string, unknown>,
  start: string,
  end: string,
) {
  const source = Array.isArray(payload.rows) ? payload.rows : [];
  let invalid = 0;
  const rows = source.flatMap((item) => {
    const row = parsedRow(provider, dataset, template, item);
    if (row === null) {
      invalid += 1;
      return [];
    }
    return row.date < start || row.date > end ? [] : [row];
  });
  return { rows, invalid, received: source.length };
}

function parsedRow(provider: string, dataset: string, template: Dataset, item: unknown) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
  let row = item as Record<string, unknown>;
  if (provider === 'ga4') {
    const dimensions = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const metrics = Array.isArray(row.metricValues) ? row.metricValues : [];
    if (
      dimensions.length !== template.dimensions.length ||
      metrics.length !== template.metrics.length
    )
      return null;
    const keys = dimensions.map((value) =>
      value !== null && typeof value === 'object' && 'value' in value ? value.value : null,
    );
    const numeric = metrics.map((value) =>
      value !== null && typeof value === 'object' && 'value' in value
        ? providerNumber(value.value)
        : null,
    );
    if (keys.some((value) => typeof value !== 'string') || numeric.includes(null)) return null;
    row = {
      keys,
      ...Object.fromEntries(template.metrics.map((name, index) => [name, numeric[index]])),
    };
  }
  const keys = values(row);
  if (keys.length !== template.dimensions.length || keys.some((key) => typeof key !== 'string'))
    return null;
  const dateIndex = template.dimensions.findIndex(
    (dimension) => dimension.toLowerCase() === 'date',
  );
  if (dateIndex < 0) return null;
  const date = isoDate(keys[dateIndex]);
  if (date === null) return null;
  const metrics = Object.fromEntries(
    template.metrics.flatMap((name) => {
      const metric = row[name];
      return typeof metric === 'number' && Number.isFinite(metric) ? [[name, metric]] : [];
    }),
  );
  if (Object.keys(metrics).length !== template.metrics.length) return null;
  const dimensionKey = keys.join(integrationPolicy.dimension_separator);
  return { provider, dataset, date, dimension_key: dimensionKey, metrics };
}
