/** Cross-page terminal evaluations and final revisions share the caller's crawl lock. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { onlyOf } from '../lists.ts';
import { compareText, scalarText } from '../text-order.ts';
import { insertEvaluations } from './analysis-rows.ts';
import {
  contentFingerprint,
  duplicateContent,
  duplicateMatches,
  type DuplicateComparison,
  type Fingerprint,
} from './analysis/duplicate-content.ts';
import { hreflangConflict, sitemapOrphan } from './analysis/finalize.ts';
import { crawlCoverage } from './coverage.ts';
import {
  canonicalResolution,
  fetchResolutions,
  linkRedirects,
  redirectChains,
  resolutionSet,
  type CanonicalTarget,
  type Resolution,
} from './resolution-evidence.ts';
import { publishFinalPageAnalyses } from './terminal-analysis.ts';
import type { Crawl } from './task-fence.ts';
import { hardExcluded } from './url-admission.ts';
import { canonicalUrl, canonicalIdentity } from './url-identity.ts';

type Facts = Record<string, unknown>;
type Alternates = Map<string, Facts[]>;

const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compareText);

/**
 * One graph edge per source and target. A URL admission refuses (an excluded
 * host such as `app.`, path, query or asset extension) is never fetched, so it
 * is never an edge nor a target the broken-link check waits on.
 */
function internalTargets(finalUrl: string, facts: Facts) {
  const anchors = record(facts.links).anchors;
  const result = new Set<string>();
  for (const value of Array.isArray(anchors) ? anchors : []) {
    const anchor = record(value);
    if (!anchor.is_internal) continue;
    const url = canonicalUrl(scalarText(anchor.url), finalUrl);
    if (url && !hardExcluded(new URL(url))) result.add(url);
  }
  return sorted(result);
}
const alternatesOf = (facts: Facts) =>
  Array.isArray(facts.hreflang_alternates) ? facts.hreflang_alternates.map(record) : [];

/** Cross-check one page's hreflang cluster against the pages this crawl analyzed. */
function hreflang(
  source: string | null,
  facts: Facts,
  pages: Alternates,
  resolutions: Map<string, Resolution>,
) {
  const declared = source ? alternatesOf(facts) : [];
  const counts = { checked: 0, unchecked: 0, limited: 0 };
  const missing = new Set<string>();
  for (const alternate of declared) {
    const raw = scalarText(alternate.url);
    const target = canonicalUrl(raw);
    if (target === source) continue;
    const returns = target ? pages.get(target) : undefined;
    if (target && resolutions.get(target)?.status === 429) counts.limited++;
    if (!target || !returns || resolutions.get(target)?.status === 429) {
      counts.unchecked++;
      continue;
    }
    counts.checked++;
    if (!returns.some((back) => canonicalUrl(scalarText(back.url)) === source)) missing.add(raw);
  }
  return hreflangConflict({
    alternateCount: declared.length,
    checkedCount: counts.checked,
    uncheckedCount: counts.unchecked,
    missingReturnTags: [...missing],
    rateLimitedCount: counts.limited,
  });
}

function canonicalDeclarations(facts: Facts) {
  const declarations = strings(facts.canonical_declarations);
  const single = scalarText(facts.canonical_url);
  return declarations.length || !single ? declarations : [single];
}

/** The page's one declared canonical in identity form; null for none or a conflicting set. */
function declaredCanonical(finalUrl: string, facts: Facts) {
  const unique = [...new Set(canonicalDeclarations(facts).map((value) => value.trim()))];
  const only = onlyOf(unique.filter(Boolean));
  return only === undefined ? null : canonicalUrl(only, finalUrl);
}

const canonicalTarget = (finalUrl: string, facts: Facts): CanonicalTarget => ({
  noindex: record(facts.robots).noindex === true,
  canonical: declaredCanonical(finalUrl, facts),
});

/**
 * A page joins the duplicate comparison when it is a successful, indexable
 * page that names no other canonical: noindex and canonicalised copies have
 * already said which page should be indexed.
 */
function duplicateCandidate(
  url: string | null,
  finalUrl: string,
  facts: Facts,
): Fingerprint | { reason: string } {
  if (!url) return { reason: 'insufficient_evidence' };
  if (!facts.has_html) return { reason: 'no_html' };
  const status = Number(record(facts.delivery).status_code);
  if (!(status >= 200 && status < 300)) return { reason: 'unsuccessful_response' };
  if (record(facts.robots).noindex === true) return { reason: 'intentional_non_indexing' };
  const canonical = declaredCanonical(finalUrl, facts);
  if (canonical && canonical !== url) return { reason: 'canonicalized_elsewhere' };
  return contentFingerprint(scalarText(facts.primary_content_text)) ?? { reason: 'thin_content' };
}

/** Every analyzed page's duplicate comparison, keyed by its identity URL. */
function duplicateComparisons(rows: { final_url: string; normalized_facts: unknown }[]) {
  const fingerprints = new Map<string, Fingerprint>();
  const excluded = new Map<string, string>();
  for (const row of rows) {
    const url = canonicalUrl(row.final_url);
    if (!url || fingerprints.has(url) || excluded.has(url)) continue;
    const candidate = duplicateCandidate(url, row.final_url, record(row.normalized_facts));
    if ('reason' in candidate) excluded.set(url, candidate.reason);
    else fingerprints.set(url, candidate);
  }
  const matches = duplicateMatches(fingerprints);
  return (url: string | null): DuplicateComparison => {
    const fingerprint = url ? fingerprints.get(url) : undefined;
    if (!url || !fingerprint)
      return { kind: 'excluded', reason: (url && excluded.get(url)) || 'insufficient_evidence' };
    return {
      kind: 'compared',
      words: fingerprint.words,
      compared: fingerprints.size - 1,
      matches: matches.get(url) ?? [],
    };
  };
}

async function sitemapObservations(db: Database, crawl: Crawl) {
  const manifest = record(record(crawl.site_facts).sitemap);
  // Older saved crawls have only source observations, not a setup manifest.
  const urls = Array.isArray(manifest.urls) ? strings(manifest.urls) : null;
  const rows = await db
    .selectFrom('site_url_observations')
    .select('observed_url')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where((eb) =>
      urls ? eb('observed_url', '=', eb.fn.any(eb.val(urls))) : eb('source_kind', '=', 'sitemap'),
    )
    .execute();
  return rows.map((row) => row.observed_url);
}

/** The root page also carries the crawl-wide sitemap orphan and reachability checks. */
async function rootEvaluations(
  db: Database,
  crawl: Crawl,
  linked: Set<string>,
  resolutions: Map<string, Resolution>,
) {
  const observed = await sitemapObservations(db, crawl);
  const rootUrl = canonicalUrl(crawl.root_url);
  const targets = sorted(observed.map((url) => canonicalUrl(url)).filter((url) => url !== null));
  const orphans = [
    ...new Set(
      observed.filter((url) => {
        const canonical = canonicalUrl(url);
        return canonical && canonical !== rootUrl && !linked.has(canonical);
      }),
    ),
  ];
  const coverage = await crawlCoverage(db, crawl);
  return [
    sitemapOrphan(observed.length, orphans, coverage.state),
    resolutionSet(targets, resolutions, true),
    redirectChains(resolutions),
  ];
}

function pendingAnalyses(db: Database, crawl: Crawl) {
  return db
    .selectFrom('site_page_analyses as p')
    .innerJoin('site_fetch_artifacts as a', (join) =>
      join
        .onRef('a.id', '=', 'p.artifact_id')
        .onRef('a.workspace_id', '=', 'p.workspace_id')
        .onRef('a.crawl_id', '=', 'p.crawl_id'),
    )
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'p.site_url_id')
        .onRef('u.workspace_id', '=', 'p.workspace_id')
        .onRef('u.project_id', '=', 'p.project_id'),
    )
    .select([
      'p.id',
      'p.site_url_id',
      'p.artifact_id',
      'u.url_hash',
      'a.final_url',
      'a.normalized_facts',
    ])
    .where('p.workspace_id', '=', crawl.workspace_id)
    .where('p.project_id', '=', crawl.project_id)
    .where('p.crawl_id', '=', crawl.id)
    .where('p.is_current', '=', true)
    .where('p.status', '=', 'completed')
    .where('p.finalized_at', 'is', null)
    .orderBy('a.id')
    .execute();
}

/** Rules a replayed pass already recorded per analysis: a repeat is dropped on conflict. */
async function recordedRules(db: Database, crawl: Crawl, analysisIds: string[]) {
  const rows = await db
    .selectFrom('site_rule_evaluations')
    .select(['analysis_id', 'rule_id'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('analysis_id', '=', sql<string>`any(${analysisIds}::uuid[])`)
    .where('source_architecture_id', 'is', null)
    .execute();
  return new Set(rows.map((row) => `${row.analysis_id}:${row.rule_id}`));
}

export async function finalizeCrawlAnalyses(db: Database, crawl: Crawl) {
  const rows = await pendingAnalyses(db, crawl);
  if (!rows.length) return;
  const resolutions = await fetchResolutions(db, crawl);
  const pages: Alternates = new Map();
  const canonicalTargets = new Map<string, CanonicalTarget>();
  for (const row of rows) {
    const url = canonicalUrl(row.final_url);
    if (!url || pages.has(url)) continue;
    const facts = record(row.normalized_facts);
    pages.set(url, alternatesOf(facts));
    canonicalTargets.set(url, canonicalTarget(row.final_url, facts));
  }
  const duplicates = duplicateComparisons(rows);
  const rootUrl = canonicalUrl(crawl.root_url);
  const rootHash = rootUrl ? canonicalIdentity(rootUrl).hash : '';
  // Admission checks each target in full, so each row's targets are found once.
  const targets = new Map(
    rows.map((row) => [row.id, internalTargets(row.final_url, record(row.normalized_facts))]),
  );
  const linked = new Set([...targets.values()].flat());
  const recorded = await recordedRules(
    db,
    crawl,
    rows.map((row) => row.id),
  );
  for (const row of rows) {
    const facts = record(row.normalized_facts);
    const url = canonicalUrl(row.final_url);
    const links = targets.get(row.id) ?? [];
    const evaluations = [
      hreflang(url, facts, pages, resolutions),
      canonicalResolution(
        canonicalDeclarations(facts),
        row.final_url,
        resolutions,
        canonicalTargets,
      ),
      resolutionSet(links, resolutions),
      linkRedirects(links, resolutions),
      duplicateContent(duplicates(url)),
    ];
    if (row.url_hash === rootHash)
      evaluations.push(...(await rootEvaluations(db, crawl, linked, resolutions))); // NOSONAR: only the root page.
    const fresh = evaluations
      .filter((evaluation) => !recorded.has(`${row.id}:${evaluation.rule_id}`))
      .map((evaluation) => ({ ...evaluation, id: randomUUID() }));
    // Sequential: one transaction's connection, under the crawl lock.
    await insertEvaluations(db, crawl, row.id, row.site_url_id, row.artifact_id, fresh); // NOSONAR
  }
  await publishFinalPageAnalyses(db, crawl);
}
