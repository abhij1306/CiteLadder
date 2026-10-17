/**
 * How the project's buyers already search, from data it has persisted:
 * imported Search Console queries and published Search Intelligence keywords.
 * Generation uses these only to steer draft phrasing. The loader reads stored
 * rows; it never fetches, and a weight orders queries without ever being
 * presented as AI prompt volume.
 */
import { sql, type RawBuilder } from 'kysely';

import { namesEntity, type EntityPolicy } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { classifyProjectQueries, normalizeQuery } from '../demand/classification.ts';
import { compareText } from '../text-order.ts';
import { bindingTokens, sharedTokens } from './binding.ts';

const O = policy.prompts.generation.observed;

type ObservedSource = 'gsc' | 'search_intelligence';
export type ObservedQuery = {
  /** The highest-impression Search Console row, or the Search Intelligence row. */
  id: string;
  source: ObservedSource;
  text: string;
  topic_id: string;
  /** Impressions for Search Console, search volume for keyword research: ordering only. */
  weight: number;
  /** The branded-query classification that admitted it: classifier version and any override. */
  classifier_version: string;
  override_id: string | null;
};
type Sourced = Omit<ObservedQuery, 'topic_id' | 'classifier_version' | 'override_id'>;

/** The evidence ref a candidate carries for each search that grounded its slot. */
export const observedRef = (
  query: Pick<ObservedQuery, 'id' | 'source' | 'classifier_version' | 'override_id'>,
) => ({
  kind: O.evidence_kind,
  source: query.source,
  id: query.id,
  classifier_version: query.classifier_version,
  override_id: query.override_id,
});
/** Whether evidence refs include an observed search: the one `grounded` rule. */
export const isGrounded = (refs: unknown) =>
  Array.isArray(refs) &&
  refs.some(
    (ref: unknown) =>
      typeof ref === 'object' && ref !== null && 'kind' in ref && ref.kind === O.evidence_kind,
  );
/** `isGrounded` in SQL, for a jsonb evidence-refs expression; false when absent. */
export const groundedSql = (refs: RawBuilder<unknown>) =>
  sql<boolean>`coalesce(${refs} @> ${JSON.stringify([{ kind: O.evidence_kind }])}::jsonb, false)`;

export type ObservedScope = {
  workspaceId: string;
  projectId: string;
  languageCode: string;
  topics: readonly { id: string; name: string; description: string }[];
  competitors: readonly { aliases: readonly string[]; rule: EntityPolicy | undefined }[];
};

const baseLanguage = (code: string) => code.trim().toLowerCase().split(/[-_]/u)[0] ?? '';

/** Search Console queries of the latest query snapshot within the window, summed per query. */
async function searchConsoleQueries(db: Database, scope: ObservedScope): Promise<Sourced[]> {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const snapshot = await workspace
    .selectFrom(db, 'query_evidence_snapshots')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!snapshot) return [];
  // A double, not int: a busy query's summed impressions can pass 2^31.
  const impressions = sql<number>`sum(impressions)::float8`;
  const rows = await workspace
    .selectFrom(db, 'query_evidence_rows')
    .select([
      'normalized_query',
      impressions.as('impressions'),
      sql<string>`(array_agg(id order by impressions desc, id))[1]`.as('id'),
    ])
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', '=', snapshot.id)
    .where('date', '>=', sql<Date>`current_date - ${O.gsc_window_days}::int`)
    .groupBy('normalized_query')
    .having(impressions, '>=', O.gsc_min_impressions)
    .orderBy('impressions', 'desc')
    .orderBy('normalized_query')
    .limit(O.source_row_limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    source: 'gsc',
    text: row.normalized_query,
    weight: row.impressions,
  }));
}

/** Keywords of the latest published dataset of each configured kind in the project language. */
async function keywordResearchQueries(db: Database, scope: ObservedScope): Promise<Sourced[]> {
  const language = baseLanguage(scope.languageCode);
  if (!language) return [];
  const workspace = new WorkspaceScope(scope.workspaceId);
  const datasets = await workspace
    .selectFrom(db, 'search_intelligence_datasets')
    .select(['id', 'dataset_kind'])
    .where('project_id', '=', scope.projectId)
    .where('status', '=', 'published')
    .where('dataset_kind', 'in', O.si_dataset_kinds)
    .where(sql<string>`split_part(lower(language_code), '-', 1)`, '=', language)
    .distinctOn('dataset_kind')
    .orderBy('dataset_kind')
    .orderBy('published_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  if (!datasets.length) return [];
  const rows = await workspace
    .selectFrom(db, 'search_intelligence_rows')
    .select(['id', 'keyword', 'search_volume'])
    .where('project_id', '=', scope.projectId)
    .where(
      'dataset_id',
      'in',
      datasets.map((row) => row.id),
    )
    .orderBy('search_volume', (order) => order.desc().nullsLast())
    .orderBy('id')
    .limit(O.source_row_limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    source: 'search_intelligence',
    text: normalizeQuery(row.keyword),
    weight: row.search_volume ?? 0,
  }));
}

// ICU word boundaries also split scripts written without spaces (Japanese, Chinese, Thai).
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

/** At least `min_tokens` words, or a shorter question opening with a question word. */
function queryShaped(text: string, language: string): boolean {
  const tokens = [...WORDS.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);
  const [first] = tokens;
  if (first === undefined || text.length > O.max_chars) return false;
  return tokens.length >= O.min_tokens || (O.question_words[language] ?? []).includes(first);
}

/** The topic sharing the most comparable tokens with `text`; none when nothing is shared. */
function bindTopic(text: string, topics: readonly { id: string; tokens: Set<string> }[]) {
  const own = bindingTokens(text);
  let best: { id: string; shared: number } | null = null;
  for (const topic of topics) {
    const shared = sharedTokens(own, topic.tokens);
    if (shared > (best?.shared ?? 0)) best = { id: topic.id, shared };
  }
  return best?.id ?? null;
}

/** Search Console impressions before keyword volume: weights of different sources never compare. */
const byWeight = (a: Sourced, b: Sourced) =>
  Number(b.source === 'gsc') - Number(a.source === 'gsc') ||
  b.weight - a.weight ||
  compareText(a.text, b.text);

/**
 * Non-branded, competitor-free, query-shaped searches bound to one of the
 * project's topics: at most `max_per_topic` per topic, Search Console
 * impressions before keyword volume, returned in that ranking order. The
 * caller authorized the project.
 */
export async function loadObservedQueries(
  db: Database,
  scope: ObservedScope,
): Promise<ObservedQuery[]> {
  const [searchConsole, research] = await Promise.all([
    searchConsoleQueries(db, scope),
    keywordResearchQueries(db, scope),
  ]);
  const language = baseLanguage(scope.languageCode);
  const shaped = [...searchConsole, ...research]
    .filter((row) => queryShaped(row.text, language))
    .filter(
      (row) => !scope.competitors.some(({ aliases, rule }) => namesEntity(row.text, aliases, rule)),
    );
  if (!shaped.length) return [];
  const classes = await classifyProjectQueries(
    db,
    scope.workspaceId,
    scope.projectId,
    shaped.map((row) => row.text),
  );
  const topics = scope.topics.map((topic) => ({
    id: topic.id,
    tokens: bindingTokens(`${topic.name} ${topic.description}`),
  }));
  const kept = new Map<string, number>();
  const seen = new Set<string>();
  return shaped.toSorted(byWeight).flatMap((row) => {
    if (seen.has(row.text)) return [];
    seen.add(row.text);
    const verdict = classes.get(row.text);
    if (verdict?.classification !== 'non_branded') return [];
    const topicId = bindTopic(row.text, topics);
    if (!topicId) return [];
    const count = kept.get(topicId) ?? 0;
    if (count >= O.max_per_topic) return [];
    kept.set(topicId, count + 1);
    return [
      {
        ...row,
        topic_id: topicId,
        classifier_version: verdict.classifier_version,
        override_id: verdict.override_id,
      },
    ];
  });
}
