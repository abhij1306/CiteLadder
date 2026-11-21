/**
 * Fanout queries (AV-8): every query an engine returned while answering,
 * exactly as it returned it (owner, 2026-11-18), counted per run at
 * finalization with the tracked brands it names and the previous comparable
 * run the Query fanouts table compares with.
 */
import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import type { Audits, ResponseAnalyses } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';
import { askedWholeSet } from '../audits/frozen-configuration.ts';
import { type EntityPolicy, namesEntity } from './aliases.ts';
import { frozenComparisonKey } from './comparison.ts';
import type { ScoringConfig } from './scoring.ts';

const UNREPORTED_STATES = new Set(['unavailable', 'count_only']);

const namedBrandSchema = z.object({ kind: z.enum(['brand', 'competitor']), name: z.string() });

export const storedQueriesSchema = z.array(
  z.object({
    query: z.string(),
    searches: z.number().int().positive(),
    brands: z.array(namedBrandSchema),
  }),
);
type StoredQuery = z.infer<typeof storedQueriesSchema>[number];
type TrackedBrand = z.infer<typeof namedBrandSchema> & {
  aliases: readonly string[];
  matching?: EntityPolicy;
};

function trackedBrands(config: ScoringConfig): TrackedBrand[] {
  return [
    {
      kind: 'brand' as const,
      name: config.brandName,
      aliases: config.brandAliases,
      matching: config.brandMatching,
    },
    ...config.competitors.map((c) => ({
      kind: 'competitor' as const,
      name: c.name,
      aliases: c.aliases,
      matching: c.matching,
    })),
  ].filter((brand) => brand.name && brand.aliases.length);
}

export function countQueries(
  queries: readonly string[],
  config: ScoringConfig,
): { totalSearches: number; queries: StoredQuery[] } {
  const counts = new Map<string, number>();
  for (const query of queries) if (query) counts.set(query, (counts.get(query) ?? 0) + 1);
  const brands = trackedBrands(config);
  const rows = [...counts]
    .map(([query, searches]) => ({
      query,
      searches,
      brands: brands
        .filter((brand) => namesEntity(query, brand.aliases, brand.matching))
        .map(({ kind, name }) => ({ kind, name })),
    }))
    .sort((a, b) => b.searches - a.searches || compareText(a.query, b.query));
  return { totalSearches: rows.reduce((sum, row) => sum + row.searches, 0), queries: rows };
}

function unreportedEngines(analyses: readonly Selectable<ResponseAnalyses>[]): string[] {
  const reported = new Set(
    analyses.filter((a) => a.fanout_state === 'queries_available').map((a) => a.logical_engine),
  );
  return [
    ...new Set(
      analyses
        .filter((a) => UNREPORTED_STATES.has(a.fanout_state) && !reported.has(a.logical_engine))
        .map((a) => a.logical_engine),
    ),
  ].sort(compareText);
}

async function previousRunId(db: Database, audit: Selectable<Audits>) {
  const key = frozenComparisonKey(audit.configuration);
  if (key === null || !askedWholeSet(audit.configuration)) return null;
  const rows = await db
    .selectFrom('audit_fanout_terms as t')
    .innerJoin('audits as a', 'a.id', 't.audit_id')
    .select(['t.audit_id', 'a.configuration'])
    .where('t.workspace_id', '=', audit.workspace_id)
    .where('a.workspace_id', '=', audit.workspace_id)
    .where('t.project_id', '=', audit.project_id)
    .where('t.audit_id', '!=', audit.id)
    .where('t.total_searches', '>', 0)
    .where('t.analyzer_version', '=', policy.audits.analysis.analyzer_version)
    .where('a.market_id', 'is not distinct from', audit.market_id)
    .where('a.audit_scope', '=', audit.audit_scope)
    .where('a.benchmark_mode', '=', audit.benchmark_mode)
    .where('a.completed_at', 'is not', null)
    .orderBy('a.completed_at', 'desc')
    .orderBy('a.id', 'desc')
    .execute();
  const previous = rows.find(
    (row) => askedWholeSet(row.configuration) && frozenComparisonKey(row.configuration) === key,
  );
  return previous?.audit_id ?? null;
}

export async function persistFanoutTerms(
  db: Database,
  audit: Selectable<Audits>,
  analyses: readonly Selectable<ResponseAnalyses>[],
  config: ScoringConfig,
  at: Date,
) {
  const { totalSearches, queries } = countQueries(
    analyses.flatMap((a) => a.fanout_queries),
    config,
  );
  const previous = totalSearches ? await previousRunId(db, audit) : null;
  await db
    .insertInto('audit_fanout_terms')
    .values({
      id: randomUUID(),
      workspace_id: audit.workspace_id,
      project_id: audit.project_id,
      audit_id: audit.id,
      previous_audit_id: previous,
      total_searches: totalSearches,
      unreported_engines: unreportedEngines(analyses),
      terms: JSON.stringify(queries),
      source_analysis_ids: JSON.stringify(analyses.map((a) => a.id)),
      analyzer_version: policy.audits.analysis.analyzer_version,
      created_at: at,
    })
    .execute();
}
