import { storedQueriesSchema } from '../analysis/fanout-terms.ts';
import type { Database } from '../db/database.ts';
import { compareText } from '../text-order.ts';
import type { FanoutResponse } from './fanout.ts';
import { brandIdentities, identityKey } from './brand-identities.ts';
import { selectedRuns, type RunSelection } from './selection.ts';

type Brands = FanoutResponse['items'][number]['brands'];

export async function comparedRunId(db: Database, selection: RunSelection) {
  const [run, other] = await selectedRuns(db, selection).select('audit.id').limit(2).execute();
  if (!run || other) return null;
  const row = await db
    .selectFrom('audit_fanout_terms')
    .select('previous_audit_id')
    .where('workspace_id', '=', selection.workspaceId)
    .where('audit_id', '=', run.id)
    .executeTakeFirst();
  return row?.previous_audit_id ?? null;
}

export async function queryBrands(
  db: Database,
  selection: RunSelection,
  auditIds: readonly string[],
): Promise<(query: string) => Brands> {
  const rows = auditIds.length
    ? await db
        .selectFrom('audit_fanout_terms')
        .select('terms')
        .where('workspace_id', '=', selection.workspaceId)
        .where('audit_id', 'in', auditIds)
        .execute()
    : [];
  const counted = rows.map((row) => storedQueriesSchema.parse(row.terms));
  if (!counted.length) return () => null;
  const named = new Map<string, Map<string, { kind: 'brand' | 'competitor'; name: string }>>();
  for (const entry of counted.flat()) {
    const brands = named.get(entry.query) ?? new Map();
    for (const brand of entry.brands) brands.set(`${brand.kind}\u0000${brand.name}`, brand);
    named.set(entry.query, brands);
  }
  const identities = await brandIdentities(db, selection);
  return (query) =>
    [...(named.get(query)?.values() ?? [])]
      .sort((a, b) => compareText(a.kind, b.kind) || compareText(a.name, b.name))
      .map((brand) => {
        const identity = identities.get(identityKey(brand.name));
        return {
          ...brand,
          logo_url: identity?.logo_url ?? null,
          website: identity?.website ?? null,
        };
      });
}
