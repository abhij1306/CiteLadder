/** Partition replacement is independent of dimension identities, including empty extracts. */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import { policy } from '../config.ts';
import { firstOf } from '../lists.ts';

const landingDimensions = JSON.stringify(policy.integrations.datasets.ga4_landing_daily.dimensions);
const aliased = (alias: string, name: string) => sql.ref(`${alias}.${name}`);
const incompatibleLanding = (alias: string) => {
  const snapshot = aliased(alias, 'query_snapshot');
  return sql<boolean>`${aliased(alias, 'dataset')}='ga4_landing_daily'
  and ${snapshot} ? 'dimensions' and ${snapshot}->'dimensions' <> ${landingDimensions}::jsonb`;
};

// A successful run completed every selected dataset. A terminal page can also
// complete one dataset before another dataset in that run fails. Raw artifacts
// stay immutable: completion is recorded on the terminal fetched page.
const complete = sql<boolean>`a.id is not null and (r.status = 'succeeded' or a.query_snapshot->>'partition_complete' = 'true')
  and not exists (select 1 from integration_import_artifacts bad
    where bad.workspace_id=r.workspace_id and bad.sync_run_id=r.id and bad.dataset=a.dataset
      and (bad.extract_metadata->>'truncated' = 'true' or ${incompatibleLanding('bad')}))`;

/** Apply to an integration_metric_rows query (plain table or the given alias). */
export function selectedPartition(alias = 'integration_metric_rows') {
  const col = (name: string) => aliased(alias, name);
  return sql<boolean>`${col('resync_seq')} = (
    select max(r.resync_seq) from integration_sync_runs r
    join integration_import_artifacts a on a.workspace_id=r.workspace_id and a.sync_run_id=r.id
    where r.workspace_id=${col('workspace_id')} and r.project_id=${col('project_id')}
      and r.property_ref=${col('property_ref')} and a.provider=${col('provider')}
      and a.dataset=${col('dataset')} and ${col('date')} between r.window_start and r.window_end
      and ${complete})`;
}

export type PartitionScope = { workspaceId: string; projectId: string; start: string; end: string };
/** Guard multi-query projections against a revision committing between scans. */
export async function partitionEpoch(
  db: Database,
  scope: Pick<PartitionScope, 'workspaceId' | 'projectId'>,
) {
  const result = await sql<{ epoch: string }>`select md5(coalesce(string_agg(
    r.id::text || ':' || r.status || ':' || coalesce(a.id::text,''), ',' order by r.id,a.id),'')) as epoch
    from integration_sync_runs r left join integration_import_artifacts a
      on a.workspace_id=r.workspace_id and a.sync_run_id=r.id
    where r.workspace_id=${scope.workspaceId}::uuid and r.project_id=${scope.projectId}::uuid`.execute(
    db,
  );
  return firstOf(result.rows, 'the partition epoch aggregate row').epoch;
}
/** The latest day covered by a complete partition of `dataset`, rows or not. */
export async function partitionAnchor(
  db: Database,
  workspaceId: string,
  projectId: string,
  dataset: string,
) {
  const result = await sql<{
    day: string | null;
  }>`select to_char(max(r.window_end),'YYYY-MM-DD') as day
    from integration_sync_runs r join integration_import_artifacts a on a.workspace_id=r.workspace_id and a.sync_run_id=r.id
    where r.workspace_id=${workspaceId}::uuid and r.project_id=${projectId}::uuid and a.dataset=${dataset} and ${complete}`.execute(
    db,
  );
  return result.rows[0]?.day ?? null;
}

const searchConsoleDay = policy.traffic.DATASET_GSC_DAY_DAILY;
// Search Console finalizes days late and returns no rows until then, so a
// complete but empty trailing day is not evidence of zero.
const latestSearchConsoleRow = (workspaceId: string, projectId: string) =>
  sql<string | null>`(select max(m.date) from integration_metric_rows m
    where m.workspace_id=${workspaceId}::uuid and m.project_id=${projectId}::uuid
      and m.dataset=${searchConsoleDay} and ${selectedPartition('m')})`;

/**
 * The Search Console anchor: the latest day with selected date-only rows.
 * A property that has never reported a row falls back to its complete
 * coverage, where an empty day cannot be told apart from lag.
 */
export async function searchConsoleAnchor(db: Database, workspaceId: string, projectId: string) {
  const result = await sql<{
    day: string | null;
  }>`select to_char(${latestSearchConsoleRow(workspaceId, projectId)},'YYYY-MM-DD') as day`.execute(
    db,
  );
  return (
    result.rows[0]?.day ?? (await partitionAnchor(db, workspaceId, projectId, searchConsoleDay))
  );
}

export async function partitionQuality(db: Database, scope: PartitionScope, dataset: string) {
  const provider = dataset.split('_')[0];
  const lagging =
    provider === 'gsc'
      ? sql<boolean>`d.day > (select day from search_console)`
      : sql<boolean>`false`;
  const result = await sql<{
    day: string;
    revision: number | null;
    flags: unknown;
    artifact_ids: unknown;
    reporting_timezone: string | null;
    currency_code: string | null;
    excluded_hosts: number;
  }>`
    with days as (select d::date as day from generate_series(${scope.start}::date,${scope.end}::date,interval '1 day') d),
    search_console as (select ${provider === 'gsc' ? latestSearchConsoleRow(scope.workspaceId, scope.projectId) : sql`null::date`} as day),
    revisions as (select d.day,r.resync_seq,r.property_ref,a.id,a.extract_metadata,${complete} as complete,
      ${incompatibleLanding('a')} as incompatible
      from days d join integration_sync_runs r on d.day between r.window_start and r.window_end
      join integration_connections connection on connection.id=r.connection_id and connection.workspace_id=r.workspace_id
      left join integration_import_artifacts a on a.workspace_id=r.workspace_id and a.sync_run_id=r.id and a.dataset=${dataset}
      where r.workspace_id=${scope.workspaceId}::uuid and r.project_id=${scope.projectId}::uuid and connection.provider=${provider}
        and (a.id is not null or r.status<>'succeeded')),
    selected as (select day,property_ref,max(resync_seq) filter(where complete) as revision,max(resync_seq) as newest
      from revisions group by day,property_ref)
    select to_char(d.day,'YYYY-MM-DD') as day,max(s.revision) as revision,
      coalesce(jsonb_agg(distinct f.flag) filter(where f.flag is not null),'[]')
        || case when count(distinct v.extract_metadata->>'timeZone')>1 then '["timezone_mismatch"]'::jsonb else '[]'::jsonb end
        || case when count(distinct v.extract_metadata->>'currencyCode')>1 then '["currency_mismatch"]'::jsonb else '[]'::jsonb end as flags,
      coalesce(jsonb_agg(distinct v.id) filter(where v.id is not null),'[]') as artifact_ids,
      case when count(distinct v.extract_metadata->>'timeZone')=1 then min(v.extract_metadata->>'timeZone') end as reporting_timezone,
      case when count(distinct v.extract_metadata->>'currencyCode')=1 then min(v.extract_metadata->>'currencyCode') end as currency_code,
      (select coalesce(sum((q.extract_metadata->'excluded_host_rows_by_date'->>to_char(q.day,'YYYY-MM-DD'))::integer),0)::integer from revisions q
        join selected qs on qs.day=q.day and qs.property_ref=q.property_ref and qs.revision=q.resync_seq where q.day=d.day) as excluded_hosts
    from days d left join selected s on s.day=d.day
      left join revisions v on v.day=s.day and v.property_ref=s.property_ref and v.resync_seq=s.revision
      left join lateral (select jsonb_array_elements_text(coalesce(v.extract_metadata->'analytics_quality','[]')) as flag
        union select 'partition_fallback' where s.newest>s.revision
        union select 'extract_contract_mismatch' where exists(select 1 from revisions old
          where old.day=d.day and old.property_ref=s.property_ref and old.resync_seq=s.newest and old.incompatible)
        union select 'unavailable' where s.revision is null or coalesce(${lagging},false)) f on true
    group by d.day order by d.day`.execute(db);
  return result.rows.map((r) => ({
    ...r,
    flags: strings(r.flags).sort(compareText),
    artifact_ids: strings(r.artifact_ids).sort(compareText),
  }));
}

export function extractMetadata(
  payload: Record<string, unknown>,
  invalidRows: boolean,
  provider = 'ga4',
) {
  const metadata = record(payload.metadata);
  let timeZone = typeof metadata.timeZone === 'string' ? metadata.timeZone : null;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      timeZone = null;
    }
  }
  const currencyCode =
    typeof metadata.currencyCode === 'string' && /^[A-Z]{3}$/u.test(metadata.currencyCode)
      ? metadata.currencyCode
      : null;
  const sampling = Array.isArray(metadata.samplingMetadatas) ? metadata.samplingMetadatas : [];
  const flags = [
    metadata.subjectToThresholding === true && 'thresholding',
    metadata.dataLossFromOtherRow === true && 'other_row_loss',
    sampling.length > 0 && 'sampling',
    invalidRows && 'invalid_rows',
    provider === 'ga4' && !timeZone && 'metadata_unavailable',
  ].filter((v): v is string => typeof v === 'string');
  return {
    timeZone,
    currencyCode,
    subjectToThresholding: metadata.subjectToThresholding ?? null,
    dataLossFromOtherRow: metadata.dataLossFromOtherRow ?? null,
    samplingMetadatas: sampling,
    analytics_quality: flags,
    truncated: invalidRows,
  };
}
