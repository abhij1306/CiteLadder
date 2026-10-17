/**
 * Change intelligence: select the comparable earlier crawl, assemble both
 * crawls' persisted page evidence, and append one immutable comparison with
 * exact source provenance. Reads persisted evidence only; no network I/O.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { compareText, scalarText } from '../text-order.ts';
import { onlyOf } from '../lists.ts';
import {
  compareCrawls,
  expectedKey,
  type ChangeObservation,
  type ChangePage,
  type ExpectedChange,
  type RuleState,
} from './change-compare.ts';
import type { Crawl } from './task-fence.ts';
import { enqueueTerminalAnalyticsRefresh } from './terminal-handoff.ts';
import { isPageRerun, pageRerunSql } from './page-rerun.ts';
import { expectedRuleOutcome } from '../opportunities/verification-decisions.ts';

const p = policy.site_health.change_intel;
// The page limit and the automatic monitor limit derived from it are left out:
// they follow the fetch budget left at admission, so they vary between
// otherwise identical crawls, and the comparison reads only pages both analyzed.
const SCOPE_KEYS = [
  'discovery_mode',
  'sample_mode',
  'root_registrable_domain',
  'include_globs',
  'exclude_globs',
  'input_mode',
  'seed_urls',
  'page_kinds',
] as const;
const RULE_FIELDS = new Map(Object.entries(p.field_rules).map(([field, rule]) => [rule, field]));

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Compact JSON with recursively sorted keys. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort(compareText)
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
function rootOrigin(crawl: Pick<Crawl, 'root_url'>) {
  const [, scheme = '', authority = ''] = /^([^:/?#]+):\/\/([^/?#]*)/.exec(crawl.root_url) ?? [];
  return `${scheme.toLowerCase()}://${authority.toLowerCase()}`;
}
function crawlScopeHash(crawl: Pick<Crawl, 'configuration'>) {
  const configuration = record(crawl.configuration);
  return sha256(
    canonicalJson(Object.fromEntries(SCOPE_KEYS.map((key) => [key, configuration[key]]))),
  );
}
const sameScope = (a: Crawl, b: Crawl) =>
  rootOrigin(a) === rootOrigin(b) && crawlScopeHash(a) === crawlScopeHash(b);
const sameVersions = (a: Crawl, b: Crawl) =>
  a.analyzer_version === b.analyzer_version && a.extractor_version === b.extractor_version;
const complete = (crawl: Crawl) => crawl.status === 'completed' && crawl.inventory_complete;

/**
 * The newest earlier crawl under the same origin, scope and versions. Without
 * one, the immediate predecessor is kept so the snapshot can name the exact
 * non-comparable boundary.
 */
async function previousComparableCrawl(db: Database, crawlB: Crawl) {
  const candidates = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', crawlB.workspace_id)
    .where('project_id', '=', crawlB.project_id)
    .where('id', '!=', crawlB.id)
    .where('status', 'in', policy.site_health.reads.terminal_crawl_statuses)
    .where('analyzed_url_count', '>', 0)
    .where(sql<boolean>`not ${pageRerunSql}`)
    .where('created_at', '<', crawlB.created_at)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(p.max_crawl_candidates)
    .execute();
  return (
    candidates.find(
      (candidate) => sameScope(candidate, crawlB) && sameVersions(candidate, crawlB),
    ) ??
    candidates[0] ??
    null
  );
}

async function pageRows(db: Database, crawl: Crawl) {
  const rows = await db
    .selectFrom('site_page_analyses as analysis')
    .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
    .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
    .innerJoin('site_url_observations as observation', (join) =>
      join
        .onRef('observation.site_url_id', '=', 'analysis.site_url_id')
        .on('observation.crawl_id', '=', crawl.id),
    )
    .select([
      'analysis.id as analysisId',
      'analysis.source_evaluation_ids',
      'artifact.id as artifactId',
      'artifact.normalized_facts',
      'artifact.status_code as artifactStatus',
      'artifact.final_url as artifactFinalUrl',
      'artifact.extractor_version',
      'url.id as siteUrlId',
      'url.normalized_url',
      'observation.status_code as observedStatus',
      'observation.final_url as observedFinalUrl',
    ])
    .where('analysis.workspace_id', '=', crawl.workspace_id)
    .where('analysis.project_id', '=', crawl.project_id)
    .where('analysis.crawl_id', '=', crawl.id)
    .where('analysis.status', '=', 'completed')
    .where('analysis.is_current', '=', true)
    .where('analysis.analyzer_version', '=', crawl.analyzer_version)
    .where('artifact.workspace_id', '=', crawl.workspace_id)
    .where('artifact.extractor_version', '=', crawl.extractor_version)
    .where('url.workspace_id', '=', crawl.workspace_id)
    .where('observation.workspace_id', '=', crawl.workspace_id)
    .orderBy('analysis.site_url_id')
    .orderBy('analysis.id')
    .limit(p.max_pages + 1)
    .execute();
  return { rows: rows.slice(0, p.max_pages), capped: rows.length > p.max_pages };
}
type PageRow = Awaited<ReturnType<typeof pageRows>>['rows'][number];
type Evaluation = {
  id: string;
  rule_id: string;
  outcome: string;
  severity: string;
  evidence: unknown;
};

/** Each analysis's change-tracked rule evaluations, from its exact source ids. */
async function evaluations(db: Database, workspaceId: string, rows: PageRow[]) {
  const owner = new Map(
    rows.flatMap((row) => (row.source_evaluation_ids ?? []).map((id) => [id, row.analysisId])),
  );
  const byAnalysis = new Map<string, Map<string, Evaluation>>();
  if (!owner.size) return byAnalysis;
  const found = await db
    .selectFrom('site_rule_evaluations')
    .select(['id', 'rule_id', 'outcome', 'severity', 'evidence'])
    .where('workspace_id', '=', workspaceId)
    .where(sql<boolean>`id = any(${[...owner.keys()]}::uuid[])`)
    .where('rule_id', 'in', Object.values(p.field_rules))
    .orderBy('id')
    .execute();
  for (const evaluation of found) {
    const analysisId = owner.get(evaluation.id)!;
    const rules = byAnalysis.get(analysisId) ?? new Map<string, Evaluation>();
    rules.set(evaluation.rule_id, evaluation);
    byAnalysis.set(analysisId, rules);
  }
  return byAnalysis;
}

/** Whether the stored text is the whole primary content, by its extraction provenance. */
function textCoverage(facts: Record<string, unknown>, content: string): [string, string | null] {
  if (!content.trim()) return ['unknown', 'no_usable_text'];
  if (!('primary_content_truncated' in facts && 'primary_content_pre_truncation_length' in facts))
    return ['unknown', 'legacy_completeness_unknown'];
  if (facts.primary_content_truncated) return ['partial', 'primary_content_truncated'];
  return ['complete', null];
}
/** Shingled primary content with the extraction's completeness provenance. */
export function contentRecord(facts: Record<string, unknown>, extractorVersion: string) {
  const content = scalarText(facts.primary_content_text);
  const words = content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const size = Math.min(p.shingle_size, words.length);
  const shingles = size
    ? [
        ...new Set(
          words.slice(0, words.length - size + 1).map((_, i) => words.slice(i, i + size).join(' ')),
        ),
      ]
        .sort(compareText)
        .slice(0, p.max_shingles)
    : [];
  const [coverage, reason] = textCoverage(facts, content);
  return {
    shingles,
    heading_outline: Array.isArray(facts.primary_heading_outline)
      ? facts.primary_heading_outline
      : [],
    word_count: words.length,
    modified: record(facts.dates).modified ?? null,
    coverage,
    coverage_reason: reason,
    extractor_version: extractorVersion,
    stored_length: Array.from(content).length,
    pre_truncation_length: facts.primary_content_pre_truncation_length ?? null,
  };
}
function changePage(row: PageRow, rules: Map<string, Evaluation> | undefined): ChangePage {
  const facts = record(row.normalized_facts);
  const anchors = record(facts.links).anchors;
  const states: Record<string, RuleState> = {};
  let intendedIndexable = false;
  for (const [field, ruleId] of Object.entries(p.field_rules)) {
    const evaluation = rules?.get(ruleId);
    if (!evaluation) continue;
    states[field] = {
      outcome: evaluation.outcome,
      severity: evaluation.severity,
      evaluationId: evaluation.id,
    };
    if (field === 'robots_noindex')
      intendedIndexable = record(evaluation.evidence).indexing_intent === 'intended_index';
  }
  return {
    siteUrlId: row.siteUrlId,
    normalizedUrl: row.normalized_url,
    analysisId: row.analysisId,
    artifactId: row.artifactId,
    rules: states,
    intendedIndexable,
    fields: {
      title: scalarText(facts.title),
      meta_description: scalarText(facts.meta_description),
      h1: Array.isArray(record(facts.headings).h1_texts) ? record(facts.headings).h1_texts : [],
      canonical: scalarText(facts.canonical_url),
      robots_noindex: Boolean(record(facts.robots).noindex),
      json_ld_present: Boolean(record(facts.structured_data).has_json_ld),
      // Extracted internal anchors, without scheduling reachability probes.
      internal_link_count: Array.isArray(anchors)
        ? anchors.filter((anchor) => record(anchor).is_internal).length
        : 0,
      http_status: row.artifactStatus || row.observedStatus,
      redirect_target: row.observedFinalUrl || row.artifactFinalUrl,
      [p.change_field]: contentRecord(facts, row.extractor_version),
    },
  };
}
async function pages(db: Database, crawl: Crawl) {
  const { rows, capped } = await pageRows(db, crawl);
  const rules = await evaluations(db, crawl.workspace_id, rows);
  return { pages: rows.map((row) => changePage(row, rules.get(row.analysisId))), capped };
}

export function declaredCheckField(check: Record<string, unknown>): [string | null, unknown] {
  if (check.kind !== 'site_rule') return [null, null];
  return [
    RULE_FIELDS.get(scalarText(check.rule_id)) ?? null,
    expectedRuleOutcome(check.expected_outcome),
  ];
}
const uuidText = (value: unknown) => scalarText(value).toLowerCase();
/** A check's target page; an untargeted check applies to a single-target event's page. */
function checkTarget(check: Record<string, unknown>, targets: Set<string>) {
  if (check.target_site_url_id != null) return uuidText(check.target_site_url_id);
  return onlyOf(targets) ?? null;
}
/** The field a check now satisfies on its target page, keyed for linkage. */
function satisfiedCheck(raw: unknown, targets: Set<string>, byUrl: Map<string, ChangePage>) {
  const check = record(raw);
  const target = checkTarget(check, targets);
  const page = target && targets.has(target) ? byUrl.get(target) : undefined;
  const [field, value] = declaredCheckField(check);
  if (!page || !field) return null;
  const rule = page.rules[field];
  const actual = check.kind === 'site_rule' && rule ? rule.outcome : page.fields[field];
  if (!isDeepStrictEqual(actual, value)) return null;
  return { key: expectedKey(page.siteUrlId, field), value: page.fields[field] };
}
/** Declared implementations whose checks crawl B's evidence now satisfies; the newest wins. */
async function expectedChanges(db: Database, crawlA: Crawl, crawlB: Crawl, pagesB: ChangePage[]) {
  const expected = new Map<string, ExpectedChange>();
  if (!crawlB.completed_at) return expected;
  const events = await db
    .selectFrom('opportunity_implementation_events')
    .select(['id', 'target_site_url_ids', 'expected_checks'])
    .where('workspace_id', '=', crawlB.workspace_id)
    .where('project_id', '=', crawlB.project_id)
    .where('declared_implemented_at', '>', crawlA.completed_at ?? crawlA.created_at)
    .where('declared_implemented_at', '<=', crawlB.completed_at)
    .orderBy('declared_implemented_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const byUrl = new Map(pagesB.map((page) => [page.siteUrlId, page]));
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  for (const event of events) {
    const targets = new Set(list(event.target_site_url_ids).map(uuidText));
    for (const raw of list(event.expected_checks)) {
      const match = satisfiedCheck(raw, targets, byUrl);
      if (match && !expected.has(match.key))
        expected.set(match.key, { eventId: event.id, expectedValue: match.value });
    }
  }
  return expected;
}

function comparisonState(
  crawlA: Crawl | null,
  crawlB: Crawl,
  pagesA: ChangePage[],
  pagesB: ChangePage[],
): [string, string | null] {
  if (!crawlA) return [p.state_unavailable, p.reason_no_previous_crawl];
  if (!sameScope(crawlA, crawlB)) return [p.state_non_comparable, p.reason_scope_mismatch];
  if (!sameVersions(crawlA, crawlB)) return [p.state_non_comparable, p.reason_version_mismatch];
  if (!pagesA.length || !pagesB.length) return [p.state_unavailable, p.reason_no_usable_evidence];
  return [p.state_available, null];
}
/** Identity of the exact compared evidence; unchanged inputs reuse their snapshot. */
function sourceHash(crawlA: Crawl | null, crawlB: Crawl, all: ChangePage[]) {
  // Fixed-width UUID pairs: joined-string order is tuple order.
  const sources = all
    .map((page) => [page.analysisId, page.artifactId])
    .sort((x, y) => compareText(x.join(), y.join()));
  return sha256(JSON.stringify({ crawl_a_id: crawlA?.id ?? null, crawl_b_id: crawlB.id, sources }));
}

async function insertObservations(
  db: Database,
  snapshotId: string,
  workspaceId: string,
  items: ChangeObservation[],
) {
  const now = new Date();
  const rows = items.map((item) => ({
    ...item,
    id: randomUUID(),
    snapshot_id: snapshotId,
    workspace_id: workspaceId,
    before_value: JSON.stringify(item.before_value),
    after_value: JSON.stringify(item.after_value),
    created_at: now,
  }));
  // Chunked only to stay under PostgreSQL's 65535 bind-parameter limit.
  const [first] = rows;
  const chunk = first ? Math.floor(65_535 / Object.keys(first).length) : 1;
  for (let start = 0; start < rows.length; start += chunk) {
    const batch = rows.slice(start, start + chunk);
    // One transaction connection runs one statement at a time.
    await db.insertInto('site_change_observations').values(batch).execute(); // NOSONAR
  }
}

/** Build, or return unchanged, the immutable comparison of crawl B with its predecessor. */
async function persistChangeSnapshot(db: Database, crawlB: Crawl): Promise<string> {
  const crawlA = await previousComparableCrawl(db, crawlB);
  const b = await pages(db, crawlB);
  const a = crawlA ? await pages(db, crawlA) : { pages: [], capped: false };
  const all = [...a.pages, ...b.pages];
  const hash = sourceHash(crawlA, crawlB, all);
  const existing = await db
    .selectFrom('site_change_snapshots')
    .select('id')
    .where('workspace_id', '=', crawlB.workspace_id)
    .where('crawl_a_id', crawlA ? '=' : 'is', crawlA?.id ?? null)
    .where('crawl_b_id', '=', crawlB.id)
    .where('source_hash', '=', hash)
    .where('analyzer_version', '=', p.analyzer_version)
    .executeTakeFirst();
  if (existing) return existing.id;
  const [state, reason] = comparisonState(crawlA, crawlB, a.pages, b.pages);
  const available = state === p.state_available;
  const capped = a.capped || b.capped;
  const completePair = Boolean(crawlA && complete(crawlA) && complete(crawlB) && !capped);
  const observations =
    crawlA && available
      ? compareCrawls(a.pages, b.pages, {
          completePair,
          expected: await expectedChanges(db, crawlA, crawlB, b.pages),
        })
      : [];
  const previous = await db
    .selectFrom('site_change_snapshots')
    .select('id')
    .where('workspace_id', '=', crawlB.workspace_id)
    .where('project_id', '=', crawlB.project_id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const counts: Record<string, number> = {};
  for (const item of observations) counts[item.change_class] = (counts[item.change_class] ?? 0) + 1;
  const sharedPages = new Set(a.pages.map((page) => page.siteUrlId));
  const id = randomUUID();
  await db
    .insertInto('site_change_snapshots')
    .values({
      id,
      workspace_id: crawlB.workspace_id,
      project_id: crawlB.project_id,
      crawl_a_id: crawlA?.id ?? null,
      crawl_b_id: crawlB.id,
      supersedes_id: previous?.id ?? null,
      state,
      reason_code: reason,
      root_origin: rootOrigin(crawlB),
      crawl_scope_hash: crawlScopeHash(crawlB),
      source_hash: hash,
      source_analysis_ids: [...new Set(all.map((page) => page.analysisId))].sort(compareText),
      source_artifact_ids: [...new Set(all.map((page) => page.artifactId))].sort(compareText),
      analyzer_version: p.analyzer_version,
      page_analyzer_version: crawlB.analyzer_version,
      extractor_version: crawlB.extractor_version,
      complete_pair: completePair,
      coverage: JSON.stringify({
        crawl_a_pages: a.pages.length,
        crawl_b_pages: b.pages.length,
        shared_pages: new Set(
          b.pages.map((page) => page.siteUrlId).filter((x) => sharedPages.has(x)),
        ).size,
        evidence_page_limit_reached: capped,
      }),
      summary: JSON.stringify({ total: observations.length, counts_by_class: counts }),
      limitations: [
        ...(completePair ? [] : ['partial_crawl_shared_urls_only']),
        ...(reason ? [reason] : []),
        ...(capped ? ['evidence_page_limit_reached'] : []),
      ],
      created_at: new Date(),
    })
    .execute();
  await insertObservations(db, id, crawlB.workspace_id, observations);
  return id;
}

/** The `change_intel` task: the snapshot and its analytics handoff commit with the task. */
export async function runChangeIntel(db: Database, crawl: Crawl) {
  // A rerun still hands its page to verification and Opportunities, but it
  // writes no comparison: against a full crawl it would read as every other
  // page removed, and it would replace the comparison Changes shows.
  const snapshot = isPageRerun(crawl) ? null : await persistChangeSnapshot(db, crawl);
  await enqueueTerminalAnalyticsRefresh(db, crawl, snapshot);
}
