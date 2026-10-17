import { createHash } from 'node:crypto';
import { policy } from '../config.ts';
import { record } from '../db/json.ts';

/** Code-point order keeps frozen measurement hashes stable. */
export function compareIdentityText(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0)!);
  const b = Array.from(right, (char) => char.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

/** json.dumps(sort_keys=True, ensure_ascii=True), for frozen measurement identities. */
function comparisonJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparisonJson).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareIdentityText(a, b))
      .map(([key, item]) => `${comparisonJson(key)}: ${comparisonJson(item)}`)
      .join(', ')}}`;
  return [...JSON.stringify(value ?? null)]
    .map((c) => {
      if (c.codePointAt(0)! < 0x7f) return c;
      return c
        .split('')
        .map((unit) => String.raw`\u${unit.codePointAt(0)!.toString(16).padStart(4, '0')}`)
        .join('');
    })
    .join('');
}
export const comparisonHash = (value: unknown) =>
  createHash('sha256').update(comparisonJson(value)).digest('hex');
export function frozenComparisonKey(
  configuration: unknown,
  engine: string | null = null,
  includePanel = true,
  includeEngines = true,
): string | null {
  const config = record(configuration);
  const policyKey = policy.opportunity.measurement_policy_key;
  const required = [
    'brand_name',
    'brand_aliases',
    'owned_domains',
    'competitors',
    'country_code',
    'language_code',
    'benchmark_mode',
    'engine_routes',
    policyKey,
  ];
  if (required.some((k) => !Object.hasOwn(config, k)) || (includePanel && !config.panel_hash))
    return null;
  const routes = record(config.engine_routes);
  const chosen = engine ? { [engine]: routes[engine] } : routes;
  if (
    !Object.keys(chosen).length ||
    Object.values(chosen).some((v) => !Object.keys(record(v)).length)
  )
    return null;
  const measurement = record(config[policyKey]);
  const fields = ['retrieval_enabled', 'max_output_tokens', 'answer_instruction'];
  if (
    fields.some((k) => !Object.hasOwn(measurement, k)) ||
    typeof measurement.retrieval_enabled !== 'boolean'
  )
    return null;
  if (
    Object.values(chosen).some((v) => !record(v).transport_provider || !record(v).transport_model)
  )
    return null;
  const identity = {
    ...Object.fromEntries(
      required.filter((k) => k !== 'engine_routes' && k !== policyKey).map((k) => [k, config[k]]),
    ),
    // A matching-policy change changes what a mention is. Audits frozen before
    // policies existed keep their original key.
    ...(config.entity_matching ? { entity_matching: config.entity_matching } : {}),
    panel: includePanel ? (config.panel_hash ?? null) : null,
    routes: includeEngines
      ? Object.fromEntries(
          Object.entries(chosen).map(([name, v]) => [
            name,
            Object.fromEntries(
              ['transport_provider', 'transport_model', 'retrieval_enabled'].map((k) => [
                k,
                record(v)[k] ?? null,
              ]),
            ),
          ]),
        )
      : null,
    measurement_policy: Object.fromEntries(fields.map((k) => [k, measurement[k]])),
    ...Object.fromEntries(
      [
        'audit_scope',
        'repetitions',
        'system_instruction',
        'products_services',
        'unintended_domains',
      ].map((k) => [k, config[k] ?? null]),
    ),
  };
  return comparisonHash(identity);
}
