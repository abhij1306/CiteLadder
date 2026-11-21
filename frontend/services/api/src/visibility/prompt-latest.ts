import { sql } from 'kysely';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { groupBy } from '../lists.ts';
import { round2 } from './metrics.ts';
import { enrichedRows, promptItems, type PromptMetricItem, type PromptRow } from './prompts.ts';
import { attachNamedAndSources } from './prompt-sources.ts';
import { marketOf, type RunScope } from './runs.ts';
import { TrendQueryError } from './selection.ts';

const visibility = policy.visibility;

type Measurement = {
  prompt_id: string;
  audit_id: string;
  cohort: string;
  prompt_text: string;
  versions: string;
  configuration: unknown;
  rank: number;
};

async function recentMeasurements(db: Database, scope: RunScope): Promise<Measurement[]> {
  const { rows } = await sql<Measurement>`
    select * from (
      select score.prompt_id, score.audit_id, score.cohort, score.prompt_text,
        score.analyzer_version || chr(10) || score.scoring_rule_version as versions,
        audit.configuration,
        row_number() over (
          partition by score.prompt_id
          order by audit.completed_at desc nulls last, audit.created_at desc, audit.id desc
        )::int as rank
      from prompt_metric_snapshots score
      join audits audit on audit.id = score.audit_id
      where score.workspace_id = ${scope.workspaceId}
        and score.project_id = ${scope.projectId}
        and audit.workspace_id = ${scope.workspaceId}
        and audit.project_id = ${scope.projectId}
        and score.prompt_id is not null
        and audit.audit_scope = ${visibility.brand_audit_scope}
        and audit.market_id is not distinct from ${marketOf(scope)}::uuid
        and audit.status in (${sql.join(visibility.dashboard_audit_statuses)})
    ) ranked
    where rank <= 2`.execute(db);
  return rows;
}

function change(pair: {
  current: Measurement;
  previous: Measurement | undefined;
  now: PromptMetricItem;
  before: PromptMetricItem | undefined;
}): Pick<PromptMetricItem, 'comparison_status' | 'visibility_delta'> {
  const { current, previous, now, before } = pair;
  if (previous === undefined) return { comparison_status: 'no_baseline', visibility_delta: null };
  const key = frozenComparisonKey(current.configuration, null, false);
  const comparable =
    key !== null &&
    key === frozenComparisonKey(previous.configuration, null, false) &&
    current.cohort === previous.cohort &&
    current.prompt_text === previous.prompt_text &&
    current.versions === previous.versions;
  if (!comparable) return { comparison_status: 'changed_context', visibility_delta: null };
  if (now.visibility_rate == null || before?.visibility_rate == null)
    return { comparison_status: 'no_observations', visibility_delta: null };
  return {
    comparison_status: 'comparable',
    visibility_delta: round2((now.visibility_rate - before.visibility_rate) * 100),
  };
}

const pairKey = (promptId: string, auditId: string) => `${promptId}:${auditId}`;

async function measuredRows(db: Database, scope: RunScope, recent: readonly Measurement[]) {
  const wanted = new Set(recent.map((row) => pairKey(row.prompt_id, row.audit_id)));
  const reads = [...groupBy(recent, (row) => row.cohort)].map(([cohort, measured]) =>
    enrichedRows(db, scope, { cohort, logicalEngine: null }, [
      ...new Set(measured.map((row) => row.audit_id)),
    ]),
  );
  const rows = new Map<string, PromptRow>();
  for (const row of (await Promise.all(reads)).flat()) {
    const key = row.item.prompt_id ? pairKey(row.item.prompt_id, row.item.audit_id) : '';
    if (wanted.has(key)) rows.set(key, row);
  }
  return rows;
}

export async function getLatestPromptMetrics(
  db: Database,
  scope: RunScope,
  query: { narrowed: boolean },
): Promise<PromptMetricItem[]> {
  if (query.narrowed)
    throw new TrendQueryError('A per-prompt latest read takes no engine, cohort, run or baseline');
  const recent = await recentMeasurements(db, scope);
  const rows = await measuredRows(db, scope, recent);
  const latest: PromptRow[] = [];
  for (const [promptId, pair] of groupBy(recent, (row) => row.prompt_id)) {
    const current = pair.find((row) => row.rank === 1);
    const previous = pair.find((row) => row.rank === 2);
    const row = current && rows.get(pairKey(promptId, current.audit_id));
    if (current === undefined || row === undefined) continue;
    const before = previous && rows.get(pairKey(promptId, previous.audit_id))?.item;
    Object.assign(row.item, change({ current, previous, now: row.item, before }));
    latest.push(row);
  }
  await attachNamedAndSources(db, scope, latest);
  return promptItems(db, scope, latest);
}
