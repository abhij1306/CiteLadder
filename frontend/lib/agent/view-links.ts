import type { AgentView } from '@citeladder/contracts/agent-views';

import { collectionTabOf } from '@/components/search-intelligence/search-intelligence-collection-state';

function href(path: string, params: Readonly<Record<string, string | null>>) {
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
  ).toString();
  return search ? `${path}?${search}` : path;
}

export function agentViewHref(view: AgentView, datasetKind: string | null = null): string {
  switch (view.kind) {
    case 'visibility_trend':
      return href('/insights', {
        market: view.market_id,
        topic: view.topic_id,
        range: view.range,
      });
    case 'visibility_ranking':
      return href('/competitors', { market: view.market_id, topic: view.topic_id });
    case 'visibility_sources':
      return href('/visibility', { tab: 'domains', market: view.market_id, topic: view.topic_id });
    case 'site_health_summary':
      return href('/site', { crawl_id: view.crawl_id });
    case 'ai_traffic_overview':
      return href('/ai-traffic', { tab: 'overview', range: view.range });
    case 'keyword_research_rows':
      return href('/search-intelligence', {
        tab: datasetKind === null ? null : collectionTabOf(datasetKind),
      });
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}
