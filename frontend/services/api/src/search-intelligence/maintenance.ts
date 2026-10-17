import type { Database } from '../db/database.ts';
import { jsonObjects } from '../db/json.ts';
import { AcquisitionState } from './acquisition-state.ts';
import { si } from './requests.ts';
import { getLogger } from '../logging.ts';

/** The queue sweeper may exhaust a dead analytics worker; recover saved receipts with no HTTP. */
export async function reconcileResearch(db: Database, at = new Date(), canAdmit = () => true) {
  if (!canAdmit()) return 0;
  const candidates = await db
    .selectFrom('search_intelligence_runs as r')
    .innerJoin('analytics_tasks as t', (join) =>
      join
        .onRef('t.id', '=', 'r.analytics_task_id')
        .onRef('t.workspace_id', '=', 'r.workspace_id')
        .onRef('t.project_id', '=', 'r.project_id'),
    )
    .selectAll('t')
    .select(['r.id as run_id', 'r.call_plan'])
    .where('r.status', 'in', ['queued', 'running'])
    .where('t.status', 'in', ['failed', 'cancelled'])
    .orderBy('r.updated_at')
    .limit(si.maintenance_batch_size)
    .execute();
  for (const candidate of candidates) {
    if (!canAdmit()) break;
    try {
      const state = new AcquisitionState(db, candidate, candidate.run_id),
        plans = jsonObjects(candidate.call_plan, 'Research recovery plan');
      const receipts = await state
        .calls()
        .where('status', '=', 'dispatched')
        .where('sanitized_response', 'is not', null)
        .orderBy('sequence')
        .execute();
      for (const call of receipts) {
        const plan = plans[call.sequence];
        if (plan && (await state.settle(plan, call.id, plans.slice(call.sequence + 1), at, true)))
          break;
      }
      await db.transaction().execute(async (trx) => {
        const run = await state.run(trx).forUpdate().skipLocked().executeTakeFirst();
        if (!run || !['queued', 'running'].includes(run.status) || !(await state.terminalTask(trx)))
          return;
        const calls = await state.calls(trx).forUpdate().execute();
        let uncertain = 0;
        for (const call of calls.filter(
          (item) => item.status === 'dispatched' && item.sanitized_response === null,
        )) {
          const dispatch = await trx
            .selectFrom('search_intelligence_dispatch_attempts')
            .selectAll()
            .where('workspace_id', '=', run.workspace_id)
            .where('project_id', '=', run.project_id)
            .where('call_id', '=', call.id)
            .where('phase', '=', 'dispatch')
            .orderBy('ordinal', 'desc')
            .executeTakeFirst();
          if (dispatch)
            await state.outcome(
              trx,
              call,
              dispatch.ordinal,
              dispatch.dispatched_at,
              'uncertain',
              null,
              at,
            );
          await trx
            .updateTable('search_intelligence_calls')
            .set({ status: 'uncertain', error_code: 'provider_result_missing', completed_at: at })
            .where('id', '=', call.id)
            .where('workspace_id', '=', run.workspace_id)
            .execute();
          uncertain++;
        }
        let status: 'uncertain' | 'cancelled' | 'partial' | 'failed' = 'failed';
        if (uncertain) status = 'uncertain';
        else if (candidate.status === 'cancelled') status = 'cancelled';
        else if (run.completed_calls) status = 'partial';
        await trx
          .updateTable('search_intelligence_runs')
          .set({
            status,
            uncertain_calls: run.uncertain_calls + uncertain,
            error_code: uncertain ? 'provider_result_missing' : 'acquisition_queue_terminal',
            completed_at: at,
            updated_at: at,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
        await trx
          .updateTable('search_intelligence_datasets')
          .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
          .where('workspace_id', '=', run.workspace_id)
          .where('project_id', '=', run.project_id)
          .where('run_id', '=', run.id)
          .where('status', '=', 'collecting')
          .execute();
      });
    } catch {
      getLogger('workers.research').info('research_maintenance_failed', {
        run_id: candidate.run_id,
      });
    }
  }
  return candidates.length;
}
