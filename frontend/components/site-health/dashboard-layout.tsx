import { InventorySection } from '@/components/site-health/inventory-section';
import { ScoreSection } from '@/components/site-health/score-section';
import { PageKindScores } from '@/components/site-health/page-kind-scores';
import { SiteFactsPanel } from '@/components/site-health/site-facts-panel';
import { Stack } from '@/components/ui/layout';
import type { useSiteHealthScreen } from '@/lib/site-health/use-site-health-screen';

export function SiteHealthDashboardLayout({
  screen,
}: Readonly<{ screen: ReturnType<typeof useSiteHealthScreen> }>) {
  const { inventoryMode, crawl, active, dashboardQuery, runExport, exporting } = screen;
  if (!crawl) return null;

  return (
    <Stack gap="workspace" className="min-w-0" data-testid="site-health-canonical">
      <ScoreSection crawl={crawl} dashboard={dashboardQuery.data} />

      <InventorySection
        mode={inventoryMode}
        crawl={crawl}
        active={active}
        exportPages={{ onExport: (filters) => void runExport('csv', 'pages', filters), exporting }}
      />

      <PageKindScores crawl={crawl} dashboard={dashboardQuery.data} />

      <SiteFactsPanel crawl={crawl} dashboard={dashboardQuery.data} />
    </Stack>
  );
}
