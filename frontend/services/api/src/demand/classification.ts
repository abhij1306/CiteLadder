import type { z } from 'zod';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { policy } from '../config.ts';
import { normalizeDomain } from '../analysis/domains.ts';
import { normalizeQuery as foldQuery } from '../traffic/normalization.ts';
import { compareText } from '../text-order.ts';
import { overrideBody } from '../routes/demand-contracts.ts';

/** The three cohorts a query can belong to; an override row is parsed into one. */
const queryClassification = overrideBody.shape.classification;
export type QueryClassification = z.infer<typeof queryClassification>;

export function normalizeQuery(value: string): string {
  return (foldQuery(value).match(/[\p{L}\p{N}_]+/gu) ?? []).join(' ');
}
export type Classification = {
  normalized_query: string;
  classification: QueryClassification;
  matched_terms: string[];
  classifier_version: string;
  override_id: string | null;
};
function classifyQuery(
  query: string,
  brand: { brand_name: string; aliases: string[]; owned_domains: string[] },
): Classification {
  const normalized = normalizeQuery(query);
  const domains = new Set<string>();
  for (const value of brand.owned_domains) {
    const host = normalizeDomain(value);
    const term = normalizeQuery(host.split('.')[0] ?? '');
    if (term) {
      domains.add(term);
      domains.add(term.replaceAll(' ', ''));
    }
  }
  const vocabulary = new Set(
    [brand.brand_name, ...brand.aliases].map(normalizeQuery).filter(Boolean),
  );
  for (const term of domains) vocabulary.add(term);
  const matched = [...vocabulary]
    .filter((term) => ` ${normalized} `.includes(` ${term} `))
    .sort(compareText);
  const canonical = normalizeQuery(brand.brand_name);
  const ambiguous =
    canonical.split(' ').length === 1 &&
    matched.includes(canonical) &&
    !matched.some((term) => domains.has(term));
  let classification: 'non_branded' | 'ambiguous' | 'branded' = 'branded';
  if (!matched.length) classification = 'non_branded';
  else if (ambiguous) classification = 'ambiguous';
  return {
    normalized_query: normalized,
    classification,
    matched_terms: matched,
    classifier_version: policy.demand.BRANDED_QUERY_CLASSIFIER_VERSION,
    override_id: null,
  };
}

export async function classifyProjectQueries(
  db: Database,
  workspaceId: string,
  projectId: string,
  queries: string[],
): Promise<Map<string, Classification>> {
  const values = [...new Set(queries.map(normalizeQuery).filter(Boolean))].sort(compareText);
  const result = new Map<string, Classification>();
  if (!values.length) return result;
  const scope = new WorkspaceScope(workspaceId);
  const project = await scope
    .selectFrom(db, 'projects')
    .select(['id', 'brand_name'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!project) return result;
  const brand = await db
    .selectFrom('brands')
    .select(['id', 'name'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const aliases = brand
    ? await db
        .selectFrom('brand_aliases')
        .select('alias')
        .where('brand_id', '=', brand.id)
        .execute()
    : [];
  const domains = await db
    .selectFrom('owned_domains')
    .select('domain')
    .where('project_id', '=', projectId)
    .execute();
  const overrides = await scope
    .selectFrom(db, 'branded_query_overrides')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('normalized_query', 'in', values)
    .distinctOn('normalized_query')
    .orderBy('normalized_query')
    .orderBy('ordinal', 'desc')
    .execute();
  const byQuery = new Map(overrides.map((r) => [r.normalized_query, r]));
  for (const query of values) {
    const override = byQuery.get(query);
    result.set(
      query,
      override
        ? {
            normalized_query: query,
            classification: queryClassification.parse(override.classification),
            matched_terms: [],
            classifier_version: override.classifier_version,
            override_id: override.id,
          }
        : classifyQuery(query, {
            brand_name: brand?.name ?? project.brand_name,
            aliases: aliases.map((r) => r.alias),
            owned_domains: domains.map((r) => r.domain),
          }),
    );
  }
  return result;
}
