/**
 * A run's Sources facts, written once by audit finalization in its
 * transaction, so the Sources table sums and unions persisted rows instead of
 * re-joining every answer and citation per read.
 *
 * - `audit_answer_aggregates`: per (engine, cohort) the run asked, the exact
 *   successful answers and the prompts they answered. A run that asked an
 *   engine and got no answer still has its row, with empty arrays, so a run
 *   without rows reads "not computed", never zero.
 * - `audit_source_aggregates`: per (engine, cohort, dimension, key) and the
 *   citation attributes the table filters and labels by, the exact answers,
 *   prompts, URLs and citation IDs behind it. Readers count distinct values
 *   over these arrays, because a URL or prompt cited in two runs is one URL or
 *   prompt.
 *
 * Prompt keys coalesce to the frozen prompt text, as the old read did: a
 * deleted prompt's snapshot has no id.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';

const SUCCEEDED = policy.visibility.succeeded_task_status;

export async function persistSourceAggregates(
  db: Database,
  run: { workspaceId: string; auditId: string; at: Date },
): Promise<void> {
  const version = policy.audits.analysis.analyzer_version;
  const promptKey = sql`coalesce(snapshot.prompt_id::text, snapshot.text)`;
  await sql`
    insert into audit_answer_aggregates
      (id, workspace_id, project_id, audit_id, logical_engine, cohort, analysis_ids, prompt_keys,
       analyzer_version, created_at)
    select gen_random_uuid(), audit.workspace_id, audit.project_id, audit.id, task.logical_engine,
      snapshot.cohort,
      coalesce(array_agg(ra.id order by ra.id) filter (where ra.id is not null), '{}'),
      coalesce(array_agg(distinct ${promptKey} order by ${promptKey})
        filter (where ra.id is not null), '{}'),
      ${version}::varchar, ${run.at}::timestamptz
    from audit_tasks task
    join audits audit on audit.id = task.audit_id and audit.workspace_id = ${run.workspaceId}
    join audit_prompt_snapshots snapshot on snapshot.id = task.prompt_snapshot_id
    left join response_analyses ra on ra.task_id = task.id and ra.audit_id = task.audit_id
      and ra.workspace_id = ${run.workspaceId} and task.status = ${SUCCEEDED}
    where task.workspace_id = ${run.workspaceId} and task.audit_id = ${run.auditId}
    group by audit.workspace_id, audit.project_id, audit.id, task.logical_engine, snapshot.cohort
  `.execute(db);
  const key = sql`case dimension.name when 'url' then citation.url else citation.domain end`;
  const urlHash = sql`case dimension.name when 'url' then citation.url_hash end`;
  await sql`
    insert into audit_source_aggregates
      (id, workspace_id, project_id, audit_id, logical_engine, cohort, dimension, key, domain,
       url_hash, source_class, classification, source_taxonomy_version, analysis_ids, prompt_keys,
       urls, citation_ids, analyzer_version, created_at)
    select gen_random_uuid(), audit.workspace_id, audit.project_id, audit.id, ra.logical_engine,
      ra.cohort, dimension.name, ${key}, citation.domain, ${urlHash}, citation.source_class,
      citation.classification, citation.source_taxonomy_version,
      array_agg(distinct ra.id order by ra.id),
      array_agg(distinct ${promptKey} order by ${promptKey}),
      array_agg(distinct citation.url order by citation.url),
      array_agg(citation.id order by citation.id),
      ${version}::varchar, ${run.at}::timestamptz
    from citations citation
    join response_analyses ra on ra.id = citation.analysis_id
      and ra.workspace_id = ${run.workspaceId} and ra.audit_id = ${run.auditId}
    join audit_tasks task on task.id = ra.task_id and task.status = ${SUCCEEDED}
    join audit_prompt_snapshots snapshot on snapshot.id = task.prompt_snapshot_id
    join audits audit on audit.id = ra.audit_id and audit.workspace_id = ${run.workspaceId}
    cross join (values ('domain'), ('url')) as dimension(name)
    where citation.workspace_id = ${run.workspaceId} and citation.audit_id = ${run.auditId}
    group by audit.workspace_id, audit.project_id, audit.id, ra.logical_engine, ra.cohort,
      dimension.name, ${key}, citation.domain, ${urlHash}, citation.source_class,
      citation.classification, citation.source_taxonomy_version
  `.execute(db);
}
