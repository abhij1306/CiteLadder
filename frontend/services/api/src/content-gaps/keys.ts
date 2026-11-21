import { canonicalHash } from '../canonical-json.ts';
import { compareText } from '../text-order.ts';

export function clusterKey(input: {
  methodologyVersion: string;
  model: string | null;
  language: string;
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
