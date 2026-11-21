import type { ProbeRun } from '@citeladder/contracts/probes';
import { sql } from 'kysely';

import { readFrozenConfiguration } from '../audits/frozen-configuration.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { ProjectScope as Scope } from '../projects/brand-profile.ts';
import { logicalEngines } from '../providers/config.ts';
import { probeRoster } from './answers.ts';
import { ANSWERED_STATUSES } from './launch-end.ts';

export function probeAudits(db: Database, scope: Scope) {
  return db
    .selectFrom('audits as a')
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('a.audit_scope', '=', policy.probes.audit_scope)
    .where('a.launch_id', 'is not', null);
}

function launchRows(db: Database, scope: Scope, limit: number, labelled: boolean) {
  const recent = probeAudits(db, scope)
    .select('a.launch_id')
    .$if(labelled, (query) =>
      query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('probe_labellings as l')
            .select('l.id')
            .whereRef('l.workspace_id', '=', 'a.workspace_id')
            .whereRef('l.launch_id', '=', 'a.launch_id')
            .where('l.outcome', '=', 'labelled'),
        ),
      ),
    )
    .groupBy('a.launch_id')
    .orderBy(sql`max(a.created_at)`, 'desc')
    .limit(limit);
  return probeAudits(db, scope)
    .leftJoin('probe_labellings as l', (join) =>
      join.onRef('l.workspace_id', '=', 'a.workspace_id').onRef('l.launch_id', '=', 'a.launch_id'),
    )
    .select([
      'a.id',
      'a.launch_id',
      'a.status',
      'a.created_at',
      'a.completed_count',
      'a.configuration',
      'a.market_id',
      'l.outcome',
    ])
    .where('a.launch_id', 'in', recent)
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id')
    .execute();
}
type LaunchRow = Awaited<ReturnType<typeof launchRows>>[number];

function launchState(audits: readonly LaunchRow[]): ProbeRun['state'] {
  const terminal = policy.audits.constants.audit_terminal_statuses;
  if (audits.some((audit) => !terminal.includes(audit.status))) return 'running';
  if (!audits.some((audit) => ANSWERED_STATUSES.includes(audit.status))) return 'failed';
  const outcome = audits[0]?.outcome ?? null;
  if (outcome === null) return 'labelling';
  return outcome === 'labelled' ? 'ready' : 'unavailable';
}

function basis(audits: readonly LaunchRow[]) {
  const configs = audits.map((audit) => readFrozenConfiguration(audit.configuration));
  const engines = new Set(configs.flatMap((config) => config.engines ?? []));
  return {
    engines: logicalEngines.filter((engine) => engines.has(engine)),
    markets: audits.map((audit, index) => ({
      id: audit.market_id,
      country_code: configs[index]!.country_code ?? '',
      language_code: configs[index]!.language_code ?? '',
    })),
    answers: audits.reduce((sum, audit) => sum + audit.completed_count, 0),
  };
}

function launch(launchId: string, audits: readonly LaunchRow[]) {
  const createdAt = new Date(
    Math.min(...audits.map((audit) => audit.created_at.getTime())),
  ).toISOString();
  const run: ProbeRun = {
    launch_id: launchId,
    state: launchState(audits),
    created_at: createdAt,
    ...basis(audits),
  };
  const answered = audits.filter((audit) => ANSWERED_STATUSES.includes(audit.status));
  const oldest = answered.at(-1);
  if (run.state !== 'ready' || !oldest) return { run, labelled: null };
  const { brand, tracked } = probeRoster(oldest.configuration);
  return {
    run,
    labelled: {
      ids: answered.map((audit) => audit.id),
      basis: { launch_id: launchId, created_at: createdAt, ...basis(answered) },
      brand,
      roster: tracked,
    },
  };
}

export async function probeLaunches(
  db: Database,
  scope: Scope,
  { limit, labelled = false }: { limit: number; labelled?: boolean },
) {
  const rows = await launchRows(db, scope, limit, labelled);
  return [...Map.groupBy(rows, (row) => row.launch_id!)].map(([launchId, audits]) =>
    launch(launchId, audits),
  );
}

export async function labelledLaunches(db: Database, scope: Scope, limit: number) {
  const launches = await probeLaunches(db, scope, { limit, labelled: true });
  return launches.flatMap((row) => (row.labelled ? [row.labelled] : []));
}
