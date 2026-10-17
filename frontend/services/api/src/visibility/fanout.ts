/** Selection-wide SQL tallies over fanout settled on each derived answer. */
import type { visibilityFanoutSummarySchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { Database } from '../db/database.ts';
import { storedInstant, utcTextOf } from '../db/timestamps.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { compareText } from '../text-order.ts';
import { authorizedSelection, evidenceScope, type RunSelection } from './selection.ts';

export type FanoutResponse = z.input<typeof visibilityFanoutSummarySchema>;

type FanoutOptions = {
  query: string | null;
  search: string | null;
  cursor: string | null;
  limit: number;
};

function fanoutPosition(options: FanoutOptions, filters: Record<string, unknown>) {
  const position = options.cursor ? decodeKeysetCursor(options.cursor, 'fanout', filters) : null;
  const asOf = position?.[0] ?? new Date().toISOString();
  const all = sql<boolean>`true`;
  if (!position) return { asOf, queryAfter: all, answerAfter: all };
  if (position.length !== 3 || !Number.isFinite(Date.parse(asOf)))
    throw new InvalidCursorError('invalid fanout cursor');
  if (options.query === null) {
    const count = Number(position[1]);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new InvalidCursorError('invalid fanout cursor');
    return {
      asOf,
      answerAfter: all,
      queryAfter: sql<boolean>`(event_count < ${count} or (event_count = ${count} and query collate "C" > ${position[2]}))`,
    };
  }
  const [, createdAt, answerId] = position;
  if (createdAt === undefined || !Number.isFinite(Date.parse(createdAt)) || !parseUuid(answerId))
    throw new InvalidCursorError('invalid fanout cursor');
  return {
    asOf,
    queryAfter: all,
    answerAfter: sql<boolean>`(created_at, id) < (${storedInstant(createdAt)}, ${answerId}::uuid)`,
  };
}

export async function getVisibilityFanout(
  db: Database,
  requested: RunSelection,
  requestedOptions: FanoutOptions,
): Promise<FanoutResponse> {
  const options = { ...requestedOptions, query: requestedOptions.query?.trim() ?? null };
  const selection = await authorizedSelection(db, requested);
  const filters = {
    ...selection,
    auditIds: [...(selection.auditIds ?? [])].sort(compareText),
    query: options.query,
    search: options.search?.trim().toLowerCase() ?? '',
  };
  const { asOf, queryAfter, answerAfter } = fanoutPosition(options, filters);
  const base = db
    .with(
      (cte) => cte('answers').materialized(),
      () =>
        evidenceScope(db, selection)
          .where('ra.created_at', '<=', new Date(asOf))
          .select([
            'ra.id',
            'ra.audit_id',
            'ra.task_id',
            'ra.logical_engine',
            'ra.brand_mentioned',
            'ra.owned_domain_cited',
            'ra.fanout_state',
            'ra.fanout_queries',
            'ra.fanout_event_count',
            'ra.created_at',
            'snapshot.text',
            sql<string>`coalesce(snapshot.prompt_id::text, snapshot.text)`.as('prompt_key'),
          ]),
    )
    .with('tallies', (db) =>
      db
        .selectFrom('answers')
        .innerJoin(
          sql<{ query: string }>`lateral (select unnest(answers.fanout_queries) as query)`.as(
            'event',
          ),
          (join) => join.onTrue(),
        )
        .select([
          'event.query',
          sql<number>`count(*)::int`.as('event_count'),
          sql<number>`count(distinct answers.prompt_key)::int`.as('prompt_count'),
          sql<
            string[]
          >`array_agg(distinct answers.logical_engine collate "C" order by answers.logical_engine collate "C")`.as(
            'engines',
          ),
          sql<number>`count(distinct answers.id)::int`.as('response_count'),
          sql<number>`count(distinct answers.id) filter (where answers.brand_mentioned)::int`.as(
            'brand_response_count',
          ),
        ])
        .groupBy('event.query'),
    );
  const matched = base
    .selectFrom('tallies')
    .selectAll()
    .$if(Boolean(filters.search), (query) =>
      query.where(sql<boolean>`position(${filters.search} in lower(query)) > 0`),
    );
  const queryPage = matched
    .where(queryAfter)
    .orderBy('event_count', 'desc')
    .orderBy(sql`query collate "C"`)
    .limit(options.limit + 1);
  const drillDown = options.query !== null;
  const answerPage = base
    .selectFrom('answers')
    .select([
      'audit_id',
      'task_id',
      'text as prompt_text',
      'logical_engine',
      'brand_mentioned',
      'owned_domain_cited',
      'id',
      utcTextOf(sql.ref('created_at')).as('created_at'),
    ])
    .where(sql<boolean>`fanout_queries @> array[${options.query ?? ''}]::text[]`)
    .where(answerAfter)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(options.limit + 1);
  const summary = await base
    .selectNoFrom([
      sql<number>`(select coalesce(sum(fanout_event_count), 0)::int from answers)`.as(
        'event_count',
      ),
      sql<number>`(select count(*)::int from tallies)`.as('distinct_queries'),
      sql<number>`(select count(*)::int from (${matched}) matched)`.as('matched_queries'),
      sql<Record<string, number>>`(select coalesce(jsonb_object_agg(state, count), '{}'::jsonb)
      from (select fanout_state as state, count(*)::int as count from answers group by fanout_state) states)`.as(
        'coverage',
      ),
      sql<number>`${
        drillDown
          ? sql`(select count(*)::int from answers where fanout_queries @> array[${options.query}]::text[])`
          : sql`0`
      }`.as('total_answers'),
      sql<
        FanoutResponse['items']
      >`(select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from (${queryPage}) page)`.as(
        'items',
      ),
      sql<(FanoutResponse['answers'][number] & { id: string; created_at: string })[]>`${
        drillDown
          ? sql`(select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from (${answerPage}) page)`
          : sql`'[]'::jsonb`
      }`.as('answers'),
    ])
    .executeTakeFirstOrThrow();
  const hasMore = (drillDown ? summary.answers : summary.items).length > options.limit;
  const items = summary.items.slice(0, options.limit);
  const answers = summary.answers.slice(0, options.limit);
  const lastQuery = items.at(-1);
  const lastAnswer = answers.at(-1);
  let keys: string[] | null = null;
  if (!drillDown && lastQuery) keys = [asOf, String(lastQuery.event_count), lastQuery.query];
  else if (lastAnswer) keys = [asOf, lastAnswer.created_at, lastAnswer.id];
  return {
    ...summary,
    items,
    answers,
    next_cursor: hasMore && keys ? encodeKeysetCursor('fanout', filters, keys) : null,
  };
}
