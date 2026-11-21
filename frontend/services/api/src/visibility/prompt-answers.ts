import type { promptAnswerSearchSchema } from '@citeladder/contracts/audits';
import type { promptAnswerPageSchema } from '@citeladder/contracts/visibility-prompt-answers';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { storedInstant, timestamptz, utcTextOf, wireUtc, wireUtcOf } from '../db/timestamps.ts';
import type { ParsedDatetime } from '../http/datetimes.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { storedAnswerFormats } from '../analysis/answer-formats.ts';
import { storedFirstNamed } from '../analysis/win-rate.ts';
import { groupBy } from '../lists.ts';
import { scopedPrompt } from '../prompts/prompts.ts';
import { compareText } from '../text-order.ts';
import { brandIdentities, identityKey } from './brand-identities.ts';
import { marketOf, type RunScope } from './runs.ts';
import { validateEngineAndRange } from './selection.ts';

const visibility = policy.visibility;
const CURSOR_SCOPE = 'prompt-answers';

type Page = z.input<typeof promptAnswerPageSchema>;
type Brand = Page['items'][number]['brands'][number];
type Search = z.infer<typeof promptAnswerSearchSchema>;

export type PromptAnswersQuery = {
  promptId: string;
  logicalEngine: string | null;
  fromAt: ParsedDatetime | null;
  toAt: ParsedDatetime | null;
  brand: string | null;
  cited: boolean | null;
  search: Search | null;
  cursor: string | null;
  limit: number;
};

const cursorSchema = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/u),
  z.uuid(),
]);

const SEARCH_FILTER = {
  used: sql<boolean>`ra.search_used`,
  not_used: sql<boolean>`not ra.search_used and ra.fanout_state <> 'unavailable'`,
  not_reported: sql<boolean>`not ra.search_used and ra.fanout_state = 'unavailable'`,
} as const satisfies Record<Search, unknown>;

export function searchOf(row: { search_used: boolean; fanout_state: string }): Search {
  if (row.search_used) return 'used';
  return row.fanout_state === 'unavailable' ? 'not_reported' : 'not_used';
}

export async function getPromptAnswers(
  db: Database,
  scope: RunScope,
  query: PromptAnswersQuery,
): Promise<Page> {
  validateEngineAndRange(query);
  await scopedPrompt(db, scope.workspaceId, query.promptId, scope.projectId);
  const fingerprint = {
    prompt: query.promptId,
    market: marketOf(scope),
    engine: query.logicalEngine,
    from: query.fromAt && wireUtcOf(query.fromAt),
    to: query.toAt && wireUtcOf(query.toAt),
    brand: query.brand && identityKey(query.brand),
    cited: query.cited,
    search: query.search,
  };
  let rows = matchingAnswers(db, scope, query)
    .select([
      'ra.id',
      'ra.task_id',
      'ra.audit_id',
      'ra.logical_engine',
      'ra.brand_mentioned',
      'ra.avg_position',
      'ra.owned_domain_cited',
      'ra.search_used',
      'ra.fanout_state',
      'ra.answer_format_state',
      'ra.answer_formats',
      'ra.in_text_link_count',
      'ra.first_named_kind',
      'ra.first_named_name',
      utcTextOf(sql.ref('a.completed_at')).as('run_at'),
    ])
    .orderBy('a.completed_at', 'desc')
    .orderBy('ra.task_id', 'desc')
    .limit(query.limit + 1);
  if (query.cursor) {
    const [at, id] = cursorPosition(query.cursor, fingerprint);
    rows = rows.where(
      sql<boolean>`(a.completed_at, ra.task_id) < (${storedInstant(at)}, ${id}::uuid)`,
    );
  }
  const found = await rows.execute();
  const page = found.slice(0, query.limit);
  const brands = await namedInOrder(
    db,
    scope,
    page.map((row) => row.id),
  );
  const last = page.at(-1);
  return {
    market_id: marketOf(scope),
    items: page.map((row) => ({
      execution_id: row.task_id,
      audit_id: row.audit_id,
      run_at: wireUtc(row.run_at),
      logical_engine: row.logical_engine,
      brands: brands.get(row.id) ?? [],
      first_named: storedFirstNamed(row),
      brand_mentioned: row.brand_mentioned,
      position:
        row.brand_mentioned && row.avg_position !== null ? Math.round(row.avg_position) : null,
      cited: row.owned_domain_cited,
      search: searchOf(row),
      answer_formats: storedAnswerFormats(row),
    })),
    next_cursor:
      last && found.length > query.limit
        ? encodeKeysetCursor(CURSOR_SCOPE, fingerprint, [last.run_at, last.task_id])
        : null,
  };
}

function cursorPosition(cursor: string, fingerprint: Record<string, unknown>) {
  const parsed = cursorSchema.safeParse(decodeKeysetCursor(cursor, CURSOR_SCOPE, fingerprint));
  if (!parsed.success) throw new InvalidCursorError('invalid cursor');
  return parsed.data;
}

const keyOf = (column: string) =>
  sql`lower(regexp_replace(btrim(${sql.ref(column)}), '\\s+', ' ', 'g'))`;

function matchingAnswers(db: Database, scope: RunScope, query: PromptAnswersQuery) {
  const { workspaceId } = scope;
  let answers = db
    .selectFrom('response_analyses as ra')
    .innerJoin('audit_tasks as task', 'task.id', 'ra.task_id')
    .innerJoin('audit_prompt_snapshots as snapshot', 'snapshot.id', 'task.prompt_snapshot_id')
    .innerJoin('audits as a', 'a.id', 'ra.audit_id')
    .where('ra.workspace_id', '=', workspaceId)
    .where('task.workspace_id', '=', workspaceId)
    .where('snapshot.workspace_id', '=', workspaceId)
    .where('a.workspace_id', '=', workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('snapshot.prompt_id', '=', query.promptId)
    .where('a.market_id', 'is not distinct from', marketOf(scope))
    .where('a.audit_scope', '=', visibility.brand_audit_scope)
    .where('a.status', 'in', visibility.dashboard_audit_statuses)
    .where('a.completed_at', 'is not', null);
  if (query.logicalEngine !== null)
    answers = answers.where('ra.logical_engine', '=', query.logicalEngine);
  if (query.fromAt !== null)
    answers = answers.where('a.completed_at', '>=', timestamptz(query.fromAt));
  if (query.toAt !== null) answers = answers.where('a.completed_at', '<=', timestamptz(query.toAt));
  if (query.cited !== null) answers = answers.where('ra.owned_domain_cited', '=', query.cited);
  if (query.search !== null) answers = answers.where(SEARCH_FILTER[query.search]);
  if (query.brand !== null) {
    const key = identityKey(query.brand);
    answers = answers.where(sql<boolean>`(
      exists (select 1 from brand_mentions bm where bm.analysis_id = ra.id
        and bm.workspace_id = ${workspaceId} and ${keyOf('bm.brand_name')} = ${key})
      or exists (select 1 from competitor_mentions cm where cm.analysis_id = ra.id
        and cm.workspace_id = ${workspaceId} and ${keyOf('cm.competitor_name')} = ${key}))`);
  }
  return answers;
}

async function namedInOrder(
  db: Database,
  scope: RunScope,
  analysisIds: readonly string[],
): Promise<Map<string, Brand[]>> {
  if (!analysisIds.length) return new Map();
  const ids = sql.join([...analysisIds]);
  const [mentions, identities] = await Promise.all([
    sql<{ analysis_id: string; kind: Brand['kind']; name: string; first_offset: number | null }>`
      select analysis_id, 'brand' as kind, brand_name as name, min(first_offset) as first_offset
      from brand_mentions
      where workspace_id = ${scope.workspaceId} and analysis_id in (${ids}) and brand_name <> ''
      group by analysis_id, brand_name
      union all
      select analysis_id, 'competitor' as kind, competitor_name as name,
        min(first_offset) as first_offset
      from competitor_mentions
      where workspace_id = ${scope.workspaceId} and analysis_id in (${ids})
        and competitor_name <> ''
      group by analysis_id, competitor_name
    `.execute(db),
    brandIdentities(db, scope),
  ]);
  const at = (offset: number | null) => offset ?? Number.MAX_SAFE_INTEGER;
  const byAnswer = groupBy(mentions.rows, (row) => row.analysis_id);
  return new Map(
    [...byAnswer].map(([id, rows]) => [
      id,
      rows
        .toSorted(
          (left, right) =>
            at(left.first_offset) - at(right.first_offset) ||
            compareText(left.kind, right.kind) ||
            compareText(left.name, right.name),
        )
        .map((row) => {
          const identity = identities.get(identityKey(row.name));
          return {
            kind: row.kind,
            name: row.name,
            logo_url: identity?.logo_url ?? null,
            website: identity?.website ?? null,
          };
        }),
    ]),
  );
}
