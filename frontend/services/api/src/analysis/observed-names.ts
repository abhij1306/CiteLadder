import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isTracked } from '../perception/untracked-names.ts';
import { compareText } from '../text-order.ts';
import {
  lockSuggestions,
  NAMED,
  suggestionRows,
  upsertNamedCandidates,
  type Evidence,
} from './observed-competitors.ts';

const aliasList = z.array(z.string());

type Seen = Evidence & { spellings: Map<string, number> };

function displayName(spellings: Map<string, number>): string {
  let best = { name: '', count: 0 };
  for (const [name, count] of spellings)
    if (count > best.count || (count === best.count && compareText(name, best.name) < 0))
      best = { name, count };
  return best.name;
}

async function observations(db: Database, workspaceId: string, auditId: string) {
  const rows = await db
    .selectFrom('answer_untracked_names as n')
    .innerJoin('response_analyses as ra', 'ra.id', 'n.analysis_id')
    .select(['n.name', 'n.name_key', 'n.analysis_id', 'ra.artifact_id', 'ra.prompt_index'])
    .select('ra.logical_engine')
    .where('n.workspace_id', '=', workspaceId)
    .where('ra.workspace_id', '=', workspaceId)
    .where('n.audit_id', '=', auditId)
    .where('ra.cohort', 'in', policy.visibility.organic_cohorts)
    .orderBy('n.name_key')
    .orderBy('n.id')
    .execute();
  const seen = new Map<string, Seen>();
  for (const row of rows) {
    const value = seen.get(row.name_key) ?? {
      spellings: new Map(),
      prompts: new Set(),
      engines: new Set(),
      analyses: new Set(),
      artifacts: new Set(),
    };
    value.spellings.set(row.name, (value.spellings.get(row.name) ?? 0) + 1);
    value.prompts.add(row.prompt_index);
    value.engines.add(row.logical_engine);
    value.analyses.add(row.analysis_id);
    value.artifacts.add(row.artifact_id);
    seen.set(row.name_key, value);
  }
  return seen;
}

export async function refreshNamedCandidates(
  db: Database,
  scope: { workspaceId: string; projectId: string; auditId: string },
) {
  const rules = policy.audits.observed_competitors.named;
  await lockSuggestions(db, scope);
  const seen = await observations(db, scope.workspaceId, scope.auditId);
  const qualified = [...seen].filter(
    ([, v]) =>
      v.prompts.size >= rules.min_distinct_prompts && v.engines.size >= rules.min_distinct_engines,
  );
  if (!qualified.length) return;
  const [candidates, roster] = await Promise.all([
    suggestionRows(db, scope)
      .select(['audit_id', 'name_key', 'status'])
      .where('kind', '=', NAMED)
      .execute(),
    db
      .selectFrom('competitors')
      .select(['name', 'aliases'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute(),
  ]);
  const { status_rejected: REJECTED } = policy.audits.observed_competitors;
  const rejected = new Set(candidates.filter((c) => c.status === REJECTED).map((c) => c.name_key));
  const existing = new Set(
    candidates.filter((c) => c.audit_id === scope.auditId).map((c) => c.name_key),
  );
  const tracked = roster.map((row) => ({ name: row.name, aliases: aliasList.parse(row.aliases) }));
  let room = rules.max_candidates_per_audit - existing.size;
  const kept = qualified
    .filter(([key, v]) => !rejected.has(key) && !isTracked(displayName(v.spellings), tracked))
    .sort(
      ([a, av], [b, bv]) =>
        bv.prompts.size - av.prompts.size || bv.engines.size - av.engines.size || compareText(a, b),
    )
    .filter(([key]) => existing.has(key) || room-- > 0);
  if (!kept.length) return;
  await upsertNamedCandidates(
    db,
    scope,
    kept.map(([key, seen]) => ({ key, name: displayName(seen.spellings), seen })),
  );
}
