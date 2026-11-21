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
      (id, workspace_id, project_id, audit_id, logical_engine, cohort, topic_id, analysis_ids,
       prompt_keys, analyzer_version, created_at)
    select gen_random_uuid(), audit.workspace_id, audit.project_id, audit.id, task.logical_engine,
      snapshot.cohort, snapshot.topic_id,
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
    group by audit.workspace_id, audit.project_id, audit.id, task.logical_engine, snapshot.cohort,
      snapshot.topic_id
  `.execute(db);
  const key = sql`case dimension.name when 'url' then citation.url else citation.domain end`;
  const urlHash = sql`case dimension.name when 'url' then citation.url_hash end`;
  await sql`
    insert into audit_source_aggregates
      (id, workspace_id, project_id, audit_id, logical_engine, cohort, topic_id, dimension, key,
       domain, url_hash, source_class, classification, source_taxonomy_version, analysis_ids, prompt_keys,
       urls, citation_ids, analyzer_version, created_at)
    select gen_random_uuid(), audit.workspace_id, audit.project_id, audit.id, ra.logical_engine,
      ra.cohort, snapshot.topic_id, dimension.name, ${key}, citation.domain, ${urlHash}, citation.source_class,
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
      snapshot.topic_id, dimension.name, ${key}, citation.domain, ${urlHash}, citation.source_class,
      citation.classification, citation.source_taxonomy_version
  `.execute(db);
}
