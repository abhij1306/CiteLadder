/**
 * Discovery-time canonical aliases: a fetched, system-selected page whose
 * declared canonical names another active, already fetched page of this crawl
 * is excluded rather than analyzed twice. The whole-crawl alias graph (cycles,
 * representatives, targets fetched later) is resolved again at finalization.
 */
import { sql } from 'kysely';
import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import { compareText, scalarText } from '../text-order.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { deactivateSystemMemberships } from './frontier.ts';
import { refreshIssueCurrency } from './issue-currency.ts';
import type { Crawl } from './site-task.ts';
import { inScope } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

function rootHash(crawl: Crawl) {
  try {
    return canonicalIdentity(crawl.root_url).hash;
  } catch {
    return '';
  }
}

function targetHash(crawl: Crawl, hash: string, declared: string, base: string) {
  if (!declared.trim()) return '';
  const configured = record(crawl.configuration).root_registrable_domain;
  let root = typeof configured === 'string' ? configured : '';
  let target: { url: string; hash: string };
  try {
    root ||= getDomain(new URL(crawl.root_url).hostname) ?? '';
    target = canonicalIdentity(declared.trim(), base);
  } catch {
    return '';
  }
  if (target.hash === hash || hash === rootHash(crawl) || !root || !inScope(target.url, root))
    return '';
  return target.hash;
}

/**
 * The hash this page aliases when its target is an active member this crawl
 * already fetched. The page is a sample's selected member, or any page a full
 * crawl's HTML walk fetched: a walked page joins the tracked set only after
 * this check, so an alias never does. A target not fetched yet may still fail
 * and be released, so the alias waits for finalization, which aliases only
 * toward a target that ended active (`reconcileDuplicateAliases`).
 */
export async function duplicateOf(
  trx: Database,
  crawl: Crawl,
  page: { hash: string; declaredCanonical: string; baseUrl: string },
) {
  const target = targetHash(crawl, page.hash, page.declaredCanonical, page.baseUrl);
  if (!target) return '';
  const rows = await trx
    .selectFrom('site_urls as u')
    .innerJoin('site_url_observations as o', (join) =>
      join
        .onRef('o.site_url_id', '=', 'u.id')
        .onRef('o.workspace_id', '=', 'u.workspace_id')
        .onRef('o.project_id', '=', 'u.project_id')
        .on('o.crawl_id', '=', crawl.id),
    )
    .leftJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 'u.id')
        .onRef('m.workspace_id', '=', 'u.workspace_id')
        .onRef('m.project_id', '=', 'u.project_id'),
    )
    .select(['u.url_hash', 'm.active'])
    .distinct()
    .where('u.workspace_id', '=', crawl.workspace_id)
    .where('u.project_id', '=', crawl.project_id)
    .where('u.url_hash', 'in', [page.hash, target])
    .execute();
  const source = rows.find((row) => row.url_hash === page.hash);
  const destination = rows.find((row) => row.url_hash === target);
  if (!source || (crawl.sample_mode && !source.active) || !destination?.active) return '';
  const fetched = await trx
    .selectFrom('site_crawl_tasks as t')
    .innerJoin('site_fetch_artifacts as a', (join) =>
      join
        .onRef('a.task_id', '=', 't.id')
        .onRef('a.workspace_id', '=', 't.workspace_id')
        .onRef('a.crawl_id', '=', 't.crawl_id'),
    )
    .select('a.id')
    .where('t.workspace_id', '=', crawl.workspace_id)
    .where('t.crawl_id', '=', crawl.id)
    .where('t.url_hash', '=', target)
    .limit(1)
    .executeTakeFirst();
  return fetched ? target : '';
}

/**
 * Exclude fetched aliases, release their sample memberships and retire their
 * current analyses. A tracked alias stays tracked (only a lowered limit removes a
 * tracked page); its analysis is retired each crawl like any alias's.
 */
export async function markDuplicates(trx: Database, crawl: Crawl, hashes: string[]) {
  if (!hashes.length) return;
  const urls = await trx
    .updateTable('site_urls')
    .set({
      corpus_disposition: 'exclude',
      disposition_reason: policy.site_health.crawl.exclusions.duplicate,
      disposition_version: policy.site_health.crawl.disposition_version,
    })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', sql<string>`any(${hashes}::text[])`)
    .returning('id')
    .execute();
  if (!urls.length) return;
  const ids = urls.map((url) => url.id);
  await deactivateSystemMemberships(trx, crawl, ids);
  const retired = await trx
    .updateTable('site_page_analyses')
    .set({ is_current: false })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', sql<string>`any(${ids}::uuid[])`)
    .where('is_current', '=', true)
    .returning('finalized_at')
    .execute();
  if (retired.some((row) => row.finalized_at !== null)) await refreshIssueCurrency(trx, crawl);
}

/** Resolve whole-crawl chains and cycles before removing any representative. */
export async function reconcileDuplicateAliases(db: Database, crawl: Crawl) {
  const rows = await db
    .selectFrom('site_urls as u')
    .innerJoin('site_url_observations as o', (join) =>
      join
        .onRef('o.site_url_id', '=', 'u.id')
        .onRef('o.workspace_id', '=', 'u.workspace_id')
        .onRef('o.project_id', '=', 'u.project_id')
        .on('o.crawl_id', '=', crawl.id),
    )
    .innerJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 'u.id')
        .onRef('m.workspace_id', '=', 'u.workspace_id')
        .onRef('m.project_id', '=', 'u.project_id'),
    )
    .select(['u.url_hash', 'm.active'])
    .distinct()
    .where('u.workspace_id', '=', crawl.workspace_id)
    .where('u.project_id', '=', crawl.project_id)
    .execute();
  const admitted = new Set(rows.map((row) => row.url_hash));
  const active = new Set(rows.filter((row) => row.active).map((row) => row.url_hash));
  // The crawl root carries the site-wide checks every page scores.
  const protectedHashes = new Set([rootHash(crawl)]);
  const artifacts = await db
    .selectFrom('site_crawl_tasks as t')
    .innerJoin('site_fetch_artifacts as a', (join) =>
      join
        .onRef('a.task_id', '=', 't.id')
        .onRef('a.workspace_id', '=', 't.workspace_id')
        .onRef('a.crawl_id', '=', 't.crawl_id'),
    )
    .select(['t.url_hash', 'a.final_url', 'a.normalized_facts'])
    .where('t.workspace_id', '=', crawl.workspace_id)
    .where('t.crawl_id', '=', crawl.id)
    .orderBy('a.fetched_at')
    .orderBy('a.id')
    .execute();
  const known = new Set<string>();
  const edges = new Map<string, string>();
  for (const artifact of artifacts) {
    if (!admitted.has(artifact.url_hash)) continue;
    known.add(artifact.url_hash);
    const target = targetHash(
      crawl,
      artifact.url_hash,
      scalarText(record(artifact.normalized_facts).canonical_url),
      artifact.final_url,
    );
    if (admitted.has(target)) edges.set(artifact.url_hash, target);
    else edges.delete(artifact.url_hash);
  }
  const duplicates = resolveDuplicateAliases({ edges, known, active, protectedHashes });
  await markDuplicates(db, crawl, duplicates);
  return duplicates.length;
}

export type AliasGraph = {
  /** Fetched page hash → the admitted hash its declared canonical names. */
  edges: Map<string, string>;
  /** Admitted hashes this crawl fetched. */
  known: Set<string>;
  active: Set<string>;
  /** Pages never excluded (the crawl root); a chain stops at one. */
  protectedHashes: Set<string>;
};

/** Where one alias chain ends: a protected page, a fetched sink, or a cycle's deterministic member. */
function representative(graph: AliasGraph, source: string) {
  const path: string[] = [];
  let current = source;
  while (true) {
    if (current !== source && graph.protectedHashes.has(current)) return current;
    const cycleStart = path.indexOf(current);
    if (cycleStart >= 0) {
      // Protected beats merely active and the lowest hash breaks the tie, so a
      // cycle resolves the same way whichever member the walk entered it from.
      const cycle = path.slice(cycleStart).sort(compareText);
      return (
        cycle.find((hash) => graph.protectedHashes.has(hash)) ??
        cycle.find((hash) => graph.active.has(hash)) ??
        ''
      );
    }
    if (!graph.known.has(current)) return '';
    path.push(current);
    const next = graph.edges.get(current);
    if (!next) return graph.active.has(current) ? current : '';
    current = next;
  }
}

/**
 * The system-selected pages to exclude as duplicates, resolved over whole
 * chains and cycles before any representative is removed: a page whose own
 * representative is itself being excluded is kept this pass.
 */
export function resolveDuplicateAliases(graph: AliasGraph) {
  const resolved = new Map<string, string>();
  for (const source of [...graph.active].sort(compareText)) {
    if (graph.protectedHashes.has(source)) continue;
    const target = representative(graph, source);
    if (target !== source && graph.active.has(target)) resolved.set(source, target);
  }
  return [...resolved].filter(([, target]) => !resolved.has(target)).map(([source]) => source);
}
