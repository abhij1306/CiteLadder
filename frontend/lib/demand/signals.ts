import type { DemandDetectorPolicy } from '@citeladder/contracts';
import { agentHandoffHref } from '@/lib/agent/handoff';
import type { DemandSignal } from '@/lib/api/demand';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';
import { isRecord } from '@/lib/utils';

type SignalType =
  | 'striking_distance'
  | 'query_cannibalization'
  | 'property_relative_ctr_gap'
  | 'high_impression_low_ctr'
  | 'emerging_query'
  | 'declining_query'
  | 'branded_query_performance';

export type FilterTab =
  | 'all'
  | 'striking_distance'
  | 'cannibalization'
  | 'ctr_gap'
  | 'trends'
  | 'branded';

const SIGNAL_GROUPS: Readonly<Record<Exclude<FilterTab, 'all'>, readonly SignalType[]>> = {
  striking_distance: ['striking_distance'],
  cannibalization: ['query_cannibalization'],
  ctr_gap: ['property_relative_ctr_gap', 'high_impression_low_ctr'],
  trends: ['emerging_query', 'declining_query'],
  branded: ['branded_query_performance'],
};

export const FILTER_TABS: readonly { tab: FilterTab; label: string }[] = [
  { tab: 'all', label: 'All signals' },
  { tab: 'striking_distance', label: 'Striking distance' },
  { tab: 'cannibalization', label: 'Cannibalization' },
  { tab: 'ctr_gap', label: 'CTR gaps' },
  { tab: 'trends', label: 'Trends' },
  { tab: 'branded', label: 'Branded' },
];

type Definition = string | ((policy: DemandDetectorPolicy) => string);

const SIGNAL_TYPE_META: Readonly<Record<SignalType, { label: string; definition: Definition }>> = {
  striking_distance: {
    label: 'Striking distance',
    definition:
      'Ranks close enough to the top results that better coverage can lift it into the positions that earn clicks.',
  },
  query_cannibalization: {
    label: 'Cannibalization',
    definition: 'More than one of your pages ranks for the query, splitting its impressions.',
  },
  property_relative_ctr_gap: {
    label: 'CTR gap',
    definition: 'Clicked less often than results at the same position across your property.',
  },
  high_impression_low_ctr: {
    label: 'Low CTR',
    definition: 'Earns many impressions but few clicks for its ranking.',
  },
  emerging_query: {
    label: 'Emerging',
    definition: ({ trends }) =>
      `Impressions rose across the last two ${trends.window_days}-day windows.`,
  },
  declining_query: {
    label: 'Declining',
    definition: ({ trends }) =>
      `Impressions fell across the last two ${trends.window_days}-day windows.`,
  },
  branded_query_performance: {
    label: 'Branded',
    definition:
      'Navigational demand for your brand, tracked apart so it cannot skew the gap analysis.',
  },
};

const FALLBACK_TYPE_META: { label: string; definition: Definition } = {
  label: 'Demand signal',
  definition: 'A Search Console gap identified by demand analysis.',
};

export function signalTypeMeta(signalType: string) {
  return (
    (SIGNAL_TYPE_META as Record<string, typeof FALLBACK_TYPE_META>)[signalType] ??
    FALLBACK_TYPE_META
  );
}

export function signalDefinition(signalType: string, policy: DemandDetectorPolicy): string {
  const { definition } = signalTypeMeta(signalType);
  return typeof definition === 'string' ? definition : definition(policy);
}

export function matchesTab(signal: DemandSignal, tab: FilterTab): boolean {
  if (tab === 'all') return true;
  return (SIGNAL_GROUPS[tab] as readonly string[]).includes(signal.signal_type);
}

export function countByTab(signals: readonly DemandSignal[], tab: FilterTab): number {
  return signals.reduce((total, signal) => total + (matchesTab(signal, tab) ? 1 : 0), 0);
}

export function isActionableGap(signal: DemandSignal): boolean {
  return signal.signal_type !== 'branded_query_performance';
}

export function numericMetric(signal: DemandSignal, key: string): number | null {
  const value = signal.metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function signalTarget(signal: DemandSignal): string {
  const target = signal.evidence.target;
  if (typeof target === 'string' && target.trim()) return target;
  return signal.topic_cluster || signal.page_url || '';
}

function signalTargetKind(signal: DemandSignal): 'Page' | 'Query' {
  return signal.evidence.target_kind === 'page' ? 'Page' : 'Query';
}

export function safePageUrl(pageUrl: string | null | undefined): string | null {
  return pageUrl && parseAbsoluteHttpUrl(pageUrl) ? pageUrl.trim() : null;
}

export type CompetingPage = { url: string; impressions: number; share: number };

export function competingPages(signal: DemandSignal): CompetingPage[] {
  const pages = signal.evidence.pages;
  if (!Array.isArray(pages)) return [];
  return pages.filter((page): page is CompetingPage => {
    if (!isRecord(page)) return false;
    const { url, impressions, share } = page;
    return (
      typeof url === 'string' &&
      typeof impressions === 'number' &&
      Number.isFinite(impressions) &&
      typeof share === 'number' &&
      Number.isFinite(share)
    );
  });
}

export function demandSignalHandoffHref(signal: DemandSignal): string {
  const target = signalTarget(signal);
  const subject = target ? ` for "${target}"` : '';
  return agentHandoffHref({
    demandSignalId: signal.id,
    targetUrl: safePageUrl(signal.page_url),
    prompt: `Help me act on this Search Console demand signal${subject}.`,
  });
}

export type RankedSignal = { signal: DemandSignal; rank: number };

export function signalPage(signal: DemandSignal): string | null {
  if (signalTargetKind(signal) === 'Page') {
    const target = signal.evidence.target;
    return typeof target === 'string' && target.trim() ? target : null;
  }
  return signal.page_url.trim() || null;
}

export function signalPageLine(signal: DemandSignal): string | null {
  if (signalTargetKind(signal) === 'Page') return null;
  const page = signalPage(signal);
  if (!page) return null;
  return pagePath(page);
}

function pagePath(page: string): string {
  const parsed = parseAbsoluteHttpUrl(page);
  return parsed ? `${parsed.pathname}${parsed.search}` : page;
}

export function signalSubject(signal: DemandSignal): { primary: string; secondary: string } {
  if (signalTargetKind(signal) === 'Page') {
    const page = signalPage(signal);
    return { primary: page ? pagePath(page) : signalTarget(signal), secondary: 'Page' };
  }
  const landing = signalPageLine(signal);
  const kind = signal.evidence.target_kind === 'query' ? 'Query' : 'Kind not reported';
  return {
    primary: signalTarget(signal),
    secondary: landing ? `${kind} · ${landing}` : kind,
  };
}
