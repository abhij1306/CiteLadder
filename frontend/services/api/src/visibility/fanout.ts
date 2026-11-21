import type { visibilityFanoutSummarySchema } from '@citeladder/contracts/visibility-evidence';
import { type RawBuilder, sql } from 'kysely';
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
import { applyFilters, type EvidenceFilters } from './evidence.ts';
import { comparedRunId, queryBrands } from './fanout-terms.ts';
import { authorizedSelection, evidenceScope, type RunSelection } from './selection.ts';

export type FanoutResponse = z.input<typeof visibilityFanoutSummarySchema>;

type FanoutOptions = {
  query: string | null;
  search: string | null;
  order: 'top' | 'rising' | 'falling';
  cursor: string | null;
  limit: number;
  filters: EvidenceFilters;
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
    ...options.filters,
    query: options.query,
    search: options.search?.trim().toLowerCase() ?? '',
    order: options.order,
  };
  const { asOf, queryAfter, answerAfter } = fanoutPosition(options, filters);
  const previousId = await comparedRunId(db, selection);
  const previousScope = previousAnswers(db, selection, previousId, options.filters);
  const base = db
    .with(
      (cte) => cte('answers').materialized(),
      () =>
        applyFilters(evidenceScope(db, selection), options.filters)
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
    )
    .with('previous', () =>
      previousScope
        .innerJoin(
          sql<{ query: string }>`lateral (select unnest(ra.fanout_queries) as query)`.as('event'),
          (join) => join.onTrue(),
        )
        .select(['event.query', sql<number>`count(*)::int`.as('event_count')])
        .groupBy('event.query'),
    )
    .with('ranked', (db) =>
      db
        .selectFrom('tallies')
        .fullJoin('previous', 'previous.query', 'tallies.query')
        .select([
          sql<string>`coalesce(tallies.query, previous.query)`.as('query'),
          sql<number>`coalesce(tallies.event_count, 0)`.as('event_count'),
          sql<number>`coalesce(tallies.prompt_count, 0)`.as('prompt_count'),
          sql<string[]>`coalesce(tallies.engines, '{}'::text[])`.as('engines'),
          sql<number>`coalesce(tallies.response_count, 0)`.as('response_count'),
          sql<number>`coalesce(tallies.brand_response_count, 0)`.as('brand_response_count'),
          sql<number>`round(coalesce(tallies.event_count::numeric
            / nullif((select sum(event_count) from tallies), 0), 0), 6)::float8`.as('share'),
          sql<number | null>`case when ${previousId !== null} then round(
            coalesce(tallies.event_count::numeric / nullif((select sum(event_count) from tallies), 0), 0)
            - coalesce(previous.event_count::numeric / nullif((select sum(event_count) from previous), 0), 0),
          6)::float8 end`.as('change'),
        ]),
    );
  const matched = base
    .selectFrom('ranked')
    .selectAll()
    .$if(Boolean(filters.search), (query) =>
      query.where(sql<boolean>`position(${filters.search} in lower(query)) > 0`),
    );
  const page = pageOrder(options, queryAfter);
  const queryPage = matched.where(page.keep).orderBy(page.order).limit(page.limit);
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
      sql<number>`(select count(*)::int from (${matched}) matched where event_count > 0)`.as(
        'matched_queries',
      ),
      sql<Record<string, number>>`(select coalesce(jsonb_object_agg(state, count), '{}'::jsonb)
      from (select fanout_state as state, count(*)::int as count from answers group by fanout_state) states)`.as(
        'coverage',
      ),
      sql<number>`${
        drillDown
          ? sql`(select count(*)::int from answers where fanout_queries @> array[${options.query}]::text[])`
          : sql`0`
      }`.as('total_answers'),
      sql<string[]>`(select coalesce(array_agg(distinct audit_id), '{}') from answers)`.as(
        'audit_ids',
      ),
      sql<
        Omit<FanoutResponse['items'][number], 'brands'>[]
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
  const { audit_ids: auditIds, ...totals } = summary;
  const items = totals.items.slice(0, options.limit);
  const answers = totals.answers.slice(0, options.limit);
  const brands = await queryBrands(db, selection, [
    ...auditIds,
    ...(previousId ? [previousId] : []),
  ]);
  return {
    ...totals,
    compared: previousId !== null,
    items: items.map((item) => ({ ...item, brands: brands(item.query) })),
    answers: answers.map(({ id: _id, created_at: _createdAt, ...answer }) => answer),
    next_cursor: nextCursor({ options, filters, asOf, totals, items, answers }),
  };
}

function previousAnswers(
  db: Database,
  selection: RunSelection,
  previousId: string | null,
  filters: EvidenceFilters,
) {
  const scope = applyFilters(
    evidenceScope(db, { ...selection, auditId: previousId ?? selection.auditId, auditIds: null }),
    filters,
  );
  return previousId === null ? scope.where(sql<boolean>`false`) : scope;
}

function pageOrder(options: FanoutOptions, queryAfter: RawBuilder<boolean>) {
  switch (options.order) {
    case 'top':
      return {
        keep: sql<boolean>`event_count > 0 and ${queryAfter}`,
        order: sql`event_count desc, query collate "C"`,
        limit: options.limit + 1,
      };
    case 'rising':
      return {
        keep: sql<boolean>`change > 0`,
        order: sql`change desc, query collate "C"`,
        limit: options.limit,
      };
    case 'falling':
      return {
        keep: sql<boolean>`change < 0`,
        order: sql`change asc, query collate "C"`,
        limit: options.limit,
      };
    default: {
      const unreachable: never = options.order;
      return unreachable;
    }
  }
}

function nextCursor(input: {
  options: FanoutOptions;
  filters: Record<string, unknown>;
  asOf: string;
  totals: { items: unknown[]; answers: unknown[] };
  items: readonly { event_count: number; query: string }[];
  answers: readonly { created_at: string; id: string }[];
}): string | null {
  const { options, asOf } = input;
  if (options.query !== null) {
    const last = input.answers.at(-1);
    if (input.totals.answers.length <= options.limit || !last) return null;
    return encodeKeysetCursor('fanout', input.filters, [asOf, last.created_at, last.id]);
  }
  const last = input.items.at(-1);
  if (options.order !== 'top' || input.totals.items.length <= options.limit || !last) return null;
  return encodeKeysetCursor('fanout', input.filters, [asOf, String(last.event_count), last.query]);
}
