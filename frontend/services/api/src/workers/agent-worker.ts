import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { createAgentBindings } from '../agent/bindings.ts';
import { leasedStatuses } from '../queue/next-due.ts';

export class AgentWorker {
  readonly db: Database;
  readonly dependencies: Awaited<ReturnType<typeof createAgentBindings>>;
  readonly workspaceId?: string;
  constructor(db: Database, dependencies: AgentWorker['dependencies'], workspaceId?: string) {
    this.db = db;
    this.dependencies = dependencies;
    this.workspaceId = workspaceId;
  }
  private async workspaces() {
    const grace = this.dependencies.settings.leaseMarginSeconds;
    let selection = this.db
      .selectFrom('agent_runs')
      .select('workspace_id')
      .select(sql<Date>`min(available_at)`.as('due'))
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', 'in', policy.task_queue.claimable),
            eb(
              'available_at',
              '<=',
              sql<Date>`clock_timestamp() - ${policy.agent.unclaimed_grace_seconds} * interval '1 second'`,
            ),
          ]),
          eb.and([
            eb('status', 'in', leasedStatuses),
            eb('lease_expires_at', '<=', sql<Date>`clock_timestamp()`),
          ]),
          eb.and([
            eb('status', '=', 'cancelled'),
            eb.exists(
              eb
                .selectFrom('agent_model_attempts')
                .select('id')
                .whereRef('agent_model_attempts.run_id', '=', 'agent_runs.id')
                .whereRef('agent_model_attempts.workspace_id', '=', 'agent_runs.workspace_id')
                .where('outcome', '=', 'dispatched')
                .where(
                  'deadline_at',
                  '<=',
                  sql<Date>`clock_timestamp() - ${grace} * interval '1 second'`,
                ),
            ),
          ]),
        ]),
      );
    if (this.workspaceId) selection = selection.where('workspace_id', '=', this.workspaceId);
    const rows = await selection
      .groupBy('workspace_id')
      .orderBy('due')
      .orderBy('workspace_id')
      .limit(policy.agent.recovery_batch_size)
      .execute();
    return rows.map((row) => row.workspace_id);
  }
  /**
   * When the earliest unclaimed turn passes its grace and this lane can end it,
   * so the chat is not blocked until the next tick. A streaming turn's lease is
   * live for its whole request, so it does not keep the runner alive.
   */
  async nextDue(): Promise<Date | null> {
    const row = await this.db
      .selectFrom('agent_runs')
      .select((eb) => eb.fn.min('available_at').as('due'))
      .where('status', 'in', policy.task_queue.claimable)
      .$if(this.workspaceId !== undefined, (q) => q.where('workspace_id', '=', this.workspaceId!))
      .executeTakeFirst();
    if (!row?.due) return null;
    return new Date(new Date(row.due).getTime() + policy.agent.unclaimed_grace_seconds * 1000);
  }
  /**
   * Turns execute only inside the browser's request; this lane never runs one.
   * It ends turns whose process stopped or that no stream claimed, and settles
   * cancelled turns' outstanding model attempts.
   */
  async runOnce() {
    const workspaces = await this.workspaces(),
      { queue, models, settings } = this.dependencies;
    const recovered = await queue.recover(
      workspaces,
      policy.agent.recovery_batch_size,
      policy.agent.unclaimed_grace_seconds,
      (db, run) => models.reconcile(db, run),
    );
    await models.recoverCancelled(
      workspaces,
      policy.agent.recovery_batch_size,
      settings.leaseMarginSeconds,
    );
    return recovered;
  }
}
