import { DemandProjection } from '@/components/demand/demand-projection';
import { SearchIntelligencePage } from '@/components/search-intelligence/search-intelligence-page';
import { PerformanceScreen } from '@/components/performance/performance-screen';

/** `/demand` authenticated application leaf. */
export function DemandRoute() {
  return <DemandProjection />;
}

/** `/search-intelligence` paid acquisition and evidence leaf. */
export function SearchIntelligenceRoute() {
  return <SearchIntelligencePage />;
}

/** `/performance` authenticated application leaf. */
export function PerformanceRoute() {
  return <PerformanceScreen />;
}
