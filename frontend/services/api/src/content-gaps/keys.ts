/**
 * The three input keys of a content-angle run (content optimization section
 * 1). Each derived part is keyed on its own inputs and the versions that
 * produced it, so a change to any of them recomputes that part and nothing
 * else; a run is appended only when one of the keys changed.
 */
import { canonicalHash } from '../canonical-json.ts';
import { compareText } from '../text-order.ts';

/** The clustering (model) key: every clustered (topic, canonical URL, title). */
export function clusterKey(input: {
  methodologyVersion: string;
  model: string | null;
  language: string;
  /** The policy that decides what is clustered: sources, per-topic bound and thresholds. */
  config: unknown;
  urls: readonly { topicId: string | null; canonicalUrl: string; title: string }[];
}): string {
  const urls = input.urls
    .map((url) => [url.topicId ?? '', url.canonicalUrl, url.title])
    .sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  return canonicalHash({
    part: 'cluster',
    methodology_version: input.methodologyVersion,
    model: input.model,
    language: input.language,
    config: input.config,
    urls,
  });
}

/** The owned-match (model) key: the clustering and the crawl whose content pages it matched. */
export function matchKey(input: {
  clusterKey: string;
  crawlId: string | null;
  methodologyVersion: string;
  model: string | null;
  config: unknown;
}): string {
  return canonicalHash({
    part: 'match',
    cluster_key: input.clusterKey,
    crawl_id: input.crawlId,
    methodology_version: input.methodologyVersion,
    model: input.model,
    config: input.config,
  });
}

/** The deterministic aggregate key: the window's audits and the formula version. */
export function aggregateKey(input: {
  formulaVersion: string;
  auditIds: readonly string[];
}): string {
  return canonicalHash({
    part: 'aggregate',
    formula_version: input.formulaVersion,
    audit_ids: [...input.auditIds].sort(compareText),
  });
}
