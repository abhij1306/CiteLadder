import type { ActivityStep } from '@/components/ui/activity-progress';
import type { BrandDiscovery } from '@/lib/api/brand-discoveries';

type DiscoveryPhase = BrandDiscovery['progress']['phase'];

const PHASE_INDEX: Record<DiscoveryPhase, number> = {
  opening_website: 0,
  understanding_business: 1,
  finding_competitors: 2,
  preparing_review: 3,
  complete: 4,
};

const COMPLETE_STATUSES = new Set<BrandDiscovery['status']>(['ready', 'project_created']);

function currentStep(discovery: BrandDiscovery | undefined): number {
  if (!discovery) return 0;
  if (COMPLETE_STATUSES.has(discovery.status)) return 4;
  return PHASE_INDEX[discovery.progress.phase];
}

function countDetail(
  count: number | undefined,
  singular: string,
  plural: string,
  action: string,
): string | undefined {
  if (!count) return undefined;
  const noun = count === 1 ? singular : plural;
  return `${count} ${noun} ${action}`;
}

function stepState(index: number, current: number): ActivityStep['state'] {
  if (index < current) return 'complete';
  if (index > current) return 'pending';
  return 'active';
}

function openingLabel(discovery: BrandDiscovery | undefined, current: number): string {
  if (!discovery) return 'Loading research progress';
  if (discovery.status === 'queued') return 'Waiting to start website research';
  return current > 0 ? 'Opened your website' : 'Opening your website';
}

/**
 * Convert persisted discovery facts into customer language. Unknown backend
 * details never become a copy fallback; adding a phase must be handled here.
 */
export function discoveryActivity(discovery: BrandDiscovery | undefined): ActivityStep[] {
  const current = currentStep(discovery);
  const progress = discovery?.progress;
  const labels = [
    openingLabel(discovery, current),
    'Reading what you offer',
    current > 2 ? 'Found comparable brands' : 'Finding comparable brands',
    current > 3 ? 'Prepared your review' : 'Preparing your review',
  ] as const;
  const details = [
    countDetail(progress?.pages_read, 'page', 'pages', 'read'),
    undefined,
    countDetail(progress?.competitors_found, 'brand', 'brands', 'found'),
    undefined,
  ] as const;
  return labels.map((label, index) => ({
    id: label,
    label,
    detail: details[index],
    state: stepState(index, current),
  }));
}
