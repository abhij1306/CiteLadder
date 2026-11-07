import type { Step, StepStatus } from '@/components/ui/step-list';
import type { BrandDiscovery } from '@/lib/api/brand-discoveries';
import { BRAND_DISCOVERY_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive } from '@/lib/jobs/poll';

type DiscoveryPhase = BrandDiscovery['progress']['phase'];
type DiscoveryStatus = BrandDiscovery['status'];

/**
 * Every discovery status: whether the research still runs on its own (the
 * screen polls it and the execution feed stays open) and whether it finished
 * with a result (every step reads as done).
 */
const DISCOVERY_STATES = {
  queued: { active: true, complete: false },
  running: { active: true, complete: false },
  failed: { active: false, complete: false },
  ready: { active: false, complete: true },
  project_created: { active: false, complete: true },
} as const satisfies Readonly<Record<DiscoveryStatus, { active: boolean; complete: boolean }>>;

export const isDiscoveryActive = (status: DiscoveryStatus | undefined): boolean =>
  status !== undefined && DISCOVERY_STATES[status].active;

/** The discovery poll cadence: while the research is still running. */
export const pollDiscovery = (status: DiscoveryStatus | undefined) =>
  pollWhileActive(DISCOVERY_STATES, BRAND_DISCOVERY_POLL_MS, status);

const PHASE_INDEX: Record<DiscoveryPhase, number> = {
  opening_website: 0,
  understanding_business: 1,
  finding_competitors: 2,
  preparing_review: 3,
  complete: 4,
};

function currentStep(discovery: BrandDiscovery | undefined): number {
  if (!discovery) return 0;
  if (DISCOVERY_STATES[discovery.status].complete) return 4;
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

function stepStatus(index: number, current: number): StepStatus {
  if (index < current) return 'done';
  if (index > current) return 'pending';
  return 'running';
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
export function discoveryActivity(discovery: BrandDiscovery | undefined): Step[] {
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
    status: stepStatus(index, current),
  }));
}
