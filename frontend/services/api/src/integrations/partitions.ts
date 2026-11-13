/** Partition replacement is independent of dimension identities, including empty extracts. */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import { policy } from '../config.ts';
import { firstOf } from '../lists.ts';
import { integrationSettings } from './config.ts';

const searchConsoleFinalityDays = integrationSettings().sync_search_console_finality_days;

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

/**
 * Days in `start`..`end` that a complete partition of any of `datasets`
 * covers: imported days, with or without rows. A gap no sync has completed
 * is not counted.
 */
export async function importedDayCount(
  db: Database,
  scope: PartitionScope,
  datasets: readonly string[],
) {
  if (datasets.length === 0) return 0;
  // Completeness is judged once per partition, before its days are expanded.
  const result = await sql<{ days: number }>`with covered as materialized (
      select distinct greatest(r.window_start::date,${scope.start}::date) as first_day,
        least(r.window_end::date,${scope.end}::date) as last_day
      from integration_sync_runs r join integration_import_artifacts a on a.workspace_id=r.workspace_id and a.sync_run_id=r.id
      where r.workspace_id=${scope.workspaceId}::uuid and r.project_id=${scope.projectId}::uuid
        and a.dataset in (${sql.join(datasets)}) and ${complete})
    select count(distinct d.day)::integer as days from covered c
      cross join lateral generate_series(c.first_day,c.last_day,interval '1 day') d(day)`.execute(
    db,
  );
  return firstOf(result.rows, 'the imported day count row').days;
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

/** The providers with an active property mapping into the project. */
export async function mappedProviders(
  db: Database,
  scope: Pick<PartitionScope, 'workspaceId' | 'projectId'>,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .selectFrom('integration_property_mappings')
    .select('provider')
    .distinct()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', '=', 'active')
    .execute();
  return new Set(rows.map((row) => row.provider));
}

/** The provider a dataset is imported from, by its name prefix. */
export const datasetProvider = (dataset: string) => dataset.split('_')[0] ?? dataset;

// Flags naming which revision was selected rather than describing the selected
// partition: a fallback to an older complete revision still observes its zeros.
const revisionNotes = new Set(['partition_fallback', 'extract_contract_mismatch']);

export type DayQuality = {
  day: string;
  revision: number | null;
  flags: readonly string[];
  not_yet_reported: boolean;
};

/**
 * Whether a day's selected partition can observe a zero: it exists, carries
 * no evidence flag, and is not a Search Console day still unreported.
 */
export function observesZero(quality: DayQuality) {
  return (
    quality.revision !== null &&
    !quality.not_yet_reported &&
    quality.flags.every((flag) => revisionNotes.has(flag))
  );
}

export async function partitionQuality(db: Database, scope: PartitionScope, dataset: string) {
  const provider = datasetProvider(dataset);
  // Search Console imports final data only, so days after its latest reported
  // row are not yet reported: a distinct state, not a missing partition.
  const lagging =
    provider === 'gsc'
      ? sql<boolean>`coalesce(d.day > (select day from search_console),false)`
      : sql<boolean>`false`;
  // Search Console finalizes days in order, within its finality days. A
  // selected revision that reported a row on or after a day, or fetched it
  // after those days, read it final. Otherwise it may have read the day before
  // Search Console finalized it: not yet reported, even once a later revision
  // reports later days. Sync re-reads such a day until it is past that bound.
  const unfinalized =
    provider === 'gsc'
      ? sql<boolean>`coalesce(bool_or(s.revision is not null
          and (select day from search_console) is not null
          and coalesce(rp.through < d.day,true)
          and d.day > (v.fetched_at at time zone ${policy.integrations.reporting_time_zones.gsc})::date
            - ${searchConsoleFinalityDays}::integer),false)`
      : sql<boolean>`false`;
  const reported =
    provider === 'gsc'
      ? sql`select property_ref,resync_seq,max(date)::date as through from integration_metric_rows
          where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
            and provider='gsc' and dataset=${searchConsoleDay}
          group by property_ref,resync_seq`
      : sql`select null::text as property_ref,null::integer as resync_seq,null::date as through where false`;
  const result = await sql<{
    day: string;
    revision: number | null;
    not_yet_reported: boolean;
    flags: unknown;
    artifact_ids: unknown;
    reporting_timezone: string | null;
    currency_code: string | null;
    excluded_hosts: number;
  }>`
    with days as (select d::date as day from generate_series(${scope.start}::date,${scope.end}::date,interval '1 day') d),
    search_console as (select ${provider === 'gsc' ? latestSearchConsoleRow(scope.workspaceId, scope.projectId) : sql`null::date`} as day),
    revisions as (select d.day,r.resync_seq,r.property_ref,a.id,a.extract_metadata,a.fetched_at,${complete} as complete,
      ${incompatibleLanding('a')} as incompatible, r.status='succeeded' as succeeded
      from days d join integration_sync_runs r on d.day between r.window_start and r.window_end
      join integration_connections connection on connection.id=r.connection_id and connection.workspace_id=r.workspace_id
      join integration_import_artifacts a on a.workspace_id=r.workspace_id and a.sync_run_id=r.id and a.dataset=${dataset}
      where r.workspace_id=${scope.workspaceId}::uuid and r.project_id=${scope.projectId}::uuid and connection.provider=${provider}),
    -- A newer revision is one that completed this dataset, or a successful run
    -- whose extract was unusable. A run still in flight, failed or cancelled
    -- before completing the dataset does not supersede the selected partition.
    selected as (select day,property_ref,max(resync_seq) filter(where complete) as revision,
      max(resync_seq) filter(where complete or succeeded) as newest
      from revisions group by day,property_ref),
    -- Each revision's latest reported Search Console day.
    reported as (${reported})
    select to_char(d.day,'YYYY-MM-DD') as day,max(s.revision) as revision,
      ${lagging} or ${unfinalized} as not_yet_reported,
      coalesce(jsonb_agg(distinct f.flag) filter(where f.flag is not null),'[]')
        || case when count(distinct v.extract_metadata->>'timeZone')>1 then '["timezone_mismatch"]'::jsonb else '[]'::jsonb end
        || case when count(distinct v.extract_metadata->>'currencyCode')>1 then '["currency_mismatch"]'::jsonb else '[]'::jsonb end as flags,
      coalesce(jsonb_agg(distinct v.id) filter(where v.id is not null),'[]') as artifact_ids,
      case when count(distinct v.extract_metadata->>'timeZone')=1 then min(v.extract_metadata->>'timeZone') end as reporting_timezone,
      case when count(distinct v.extract_metadata->>'currencyCode')=1 then min(v.extract_metadata->>'currencyCode') end as currency_code,
      (select coalesce(sum((q.extract_metadata->'excluded_host_rows_by_date'->>to_char(q.day,'YYYY-MM-DD'))::integer),0)::integer from revisions q
        join selected qs on qs.day=q.day and qs.property_ref=q.property_ref and qs.revision=q.resync_seq where q.day=d.day) as excluded_hosts
    from days d left join selected s on s.day=d.day
      left join reported rp on rp.property_ref=s.property_ref and rp.resync_seq=s.revision
      left join revisions v on v.day=s.day and v.property_ref=s.property_ref and v.resync_seq=s.revision
      left join lateral (select jsonb_array_elements_text(coalesce(v.extract_metadata->'analytics_quality','[]')) as flag
        union select 'partition_fallback' where s.newest>s.revision
        union select 'extract_contract_mismatch' where exists(select 1 from revisions old
          where old.day=d.day and old.property_ref=s.property_ref and old.resync_seq=s.newest and old.incompatible)
        union select 'unavailable' where s.revision is null and not ${lagging}) f on true
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
