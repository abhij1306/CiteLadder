import { sql } from 'kysely';
import { z } from 'zod';
import type { Actor } from '../auth/actor.ts';
import { authorize, permission, type Authorized, type Permission } from '../commands/permission.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { operatorTransaction } from '../db/operator-transaction.ts';

export type PreparedChange = Readonly<{ id: string; projectId: string }>;
type ChangeResult = Readonly<{ summary: string }> & Record<string, unknown>;
export const changePreviewSchema = z.strictObject({
  title: z.string(),
  rows: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  spend: z.string().nullable(),
  opens: z.strictObject({ label: z.string(), path: z.string() }).nullable(),
});
export type ChangePreview = z.infer<typeof changePreviewSchema>;
export type PreviewContext = Readonly<{
  db: Database;
  config: ServiceConfig;
  workspaceId: string;
  projectId: string;
}>;

type Execute<S extends z.ZodType, P extends Permission, R extends ChangeResult> = (
  trx: Database,
  config: ServiceConfig,
  actor: Authorized<P>,
  change: PreparedChange,
  payload: z.output<S>,
) => Promise<R>;

type Check<S extends z.ZodType, P extends Permission> = (
  trx: Database,
  config: ServiceConfig,
  actor: Authorized<P>,
  change: PreparedChange,
  payload: z.output<S>,
) => Promise<void>;

type Draft<S extends z.ZodType, D extends z.ZodType> = Readonly<{
  schema: D;
  complete: (context: PreviewContext, draft: z.output<D>) => Promise<z.input<S>>;
}>;

export function changeKind<
  S extends z.ZodType,
  P extends Permission,
  R extends ChangeResult,
  D extends z.ZodType = S,
>(entry: {
  permission: P;
  payload: S;
  purpose: string;
  execute: Execute<S, P, R>;
  preview: (
    context: PreviewContext,
    payload: z.output<S>,
    rehearse: () => Promise<R>,
  ) => Promise<ChangePreview>;
  draft?: Draft<S, D>;
  live?: Check<S, P>;
}) {
  return {
    permission: entry.permission,
    payload: entry.payload,
    purpose: entry.purpose,
    proposal: entry.draft?.schema ?? entry.payload,
    live: entry.live !== undefined,
    execute: entry.execute,
    async rehearse<T>(
      db: Database,
      config: ServiceConfig,
      actor: Authorized<P>,
      change: PreparedChange,
      input: z.input<S>,
      inspect: (trx: Database) => Promise<T>,
    ) {
      const payload = entry.payload.parse(input);
      const inspected = await operatorTransaction(db, false, async (trx) => {
        await entry.execute(trx, config, actor, change, payload);
        return inspect(trx);
      });
      return { payload, inspected };
    },
    async stage(context: PreviewContext, actor: Actor, change: PreparedChange, proposed: unknown) {
      const authorized = authorize(actor, entry.permission);
      const input = entry.draft
        ? await entry.draft.complete(context, entry.draft.schema.parse(proposed))
        : proposed;
      const payload = entry.payload.parse(input);
      const preview = await operatorTransaction(context.db, false, async (trx) => {
        let rehearsal: Promise<R> | undefined;
        const rehearse = () => {
          if (entry.live) return Promise.reject(new Error('A live change kind never rehearses'));
          rehearsal ??= entry.execute(trx, context.config, authorized, change, payload);
          return rehearsal;
        };
        const shown = await entry.preview({ ...context, db: trx }, payload, rehearse);
        if (entry.live) await entry.live(trx, context.config, authorized, change, payload);
        else await rehearse();
        return shown;
      });
      return { payload, preview };
    },
    confirm(
      trx: Database,
      config: ServiceConfig,
      actor: Actor,
      change: PreparedChange,
      stored: unknown,
    ) {
      return entry.execute(
        trx,
        config,
        authorize(actor, entry.permission),
        change,
        entry.payload.parse(stored),
      );
    },
  };
}

export const quoted = (texts: readonly string[]) => texts.map((text) => `“${text}”`).join(', ');
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
export const rowsOf = (label: string, values: readonly string[]) =>
  values.map((value) => ({ label, value }));

export const MEMBER_WRITE = permission({ capability: 'write' });
export const MEMBER_RUN = permission({ capability: 'run' });
export const PERMANENT = { label: 'Undo', value: 'This cannot be undone.' };
export const ROW_COUNT = sql<string>`count(*)`.as('count');
export const countOf = async (row: Promise<{ count: string } | undefined>) =>
  Number((await row)?.count ?? 0);

export async function heldUnits(
  db: Database,
  subject: Readonly<{ workspaceId: string; kind: string; ids: readonly string[] }>,
) {
  if (!subject.ids.length) return 0;
  const row = await db
    .selectFrom('consumable_ledger')
    .select(sql<string>`coalesce(sum(units), 0)`.as('units'))
    .where('workspace_id', '=', subject.workspaceId)
    .where('entry_kind', '=', 'reservation')
    .where('subject_kind', '=', subject.kind)
    .where('subject_id', 'in', subject.ids)
    .executeTakeFirst();
  return Number(row?.units ?? 0);
}
