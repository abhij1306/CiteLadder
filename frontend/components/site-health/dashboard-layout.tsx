import { InventorySection } from '@/components/site-health/inventory-section';
import { ScoreSection } from '@/components/site-health/score-section';
import { PageKindScores } from '@/components/site-health/page-kind-scores';
import { SiteFactsPanel } from '@/components/site-health/site-facts-panel';
import { StatusStrip } from '@/components/site-health/status-strip';
import { Button } from '@/components/ui/button';
import { QueryState } from '@/components/ui/query-state';
import { Stack } from '@/components/ui/layout';
import type { useSiteHealthScreen } from '@/lib/site-health/use-site-health-screen';
import { ICONS } from '@/lib/icons';
import { useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * The canonical Site Health dashboard layout.
 *
 * ONE composed screen that stays mounted through the entire discover → analyze
 * → scored lifecycle. Phase changes update each section's DATA and
 * mode — they never swap the layout for a different panel, so starting,
 * cancelling, or finishing a crawl visibly updates the screen the user is
 * already on. (The per-URL crawl detail view and the issues screen remain the
 * only other screens in the flow.)
 *
 * Reading order is answer-first: the status line (where the crawl stands and
 * its page counts), the headline score cards, the URL inventory, then page-kind
 * diagnostics. The inventory's view switch, page-kind filter and export lead
 * its table's own toolbar.
 */
export function SiteHealthDashboardLayout({
  screen,
}: Readonly<{ screen: ReturnType<typeof useSiteHealthScreen> }>) {
  const {
    phase,
    inventoryMode,
    crawl,
    active,
    dashboardQuery,
    pagesQuery,
    projectSelectedTotal,
    projectSelectedError,
    startPending,
    startCrawl,
    cancelMutation,
    runExport,
    exporting,
  } = screen;
  // Starting a crawl is offered only to a role that may run one.
  const canRun = useWorkspaceCapability('run');

  return (
    // `min-w-0` so a wide table inside a section scrolls in its own wrapper
    // instead of widening this column (and every ancestor) to its max-content.
    <Stack gap="workspace" className="min-w-0" data-testid="site-health-canonical">
      {!crawl ? (
        <FirstCrawl
          start={canRun ? { onStart: () => startCrawl(), pending: startPending } : undefined}
        />
      ) : (
        <>
          {/* Where the crawl stands, then the headline score cards (owner,
              2026-11-10: as before the one-line status strip), two blocks 12 apart. */}
          <Stack gap="workspace">
            <StatusStrip
              crawl={crawl}
              phase={phase}
              cancelPending={cancelMutation.isPending}
              startPending={startPending}
              pages={pagesQuery.data?.items ?? []}
              selectedTotal={projectSelectedTotal}
              selectedError={projectSelectedError}
              onRerun={canRun ? () => startCrawl() : undefined}
            />

            <ScoreSection crawl={crawl} dashboard={dashboardQuery.data} />
          </Stack>

          <InventorySection
            mode={inventoryMode}
            crawl={crawl}
            active={active}
            exportPages={{ onExport: () => void runExport('csv', 'pages'), exporting }}
          />

          <PageKindScores crawl={crawl} dashboard={dashboardQuery.data} />

          <SiteFactsPanel crawl={crawl} dashboard={dashboardQuery.data} />
        </>
      )}
    </Stack>
  );
}

/** The project before its first crawl; starting one is offered to a role that may run it. */
function FirstCrawl({
  start,
}: Readonly<{
  start?: Readonly<{ onStart: () => void; pending: boolean }>;
}>) {
  return (
    <div data-testid="site-health-empty">
      {start ? (
        <QueryState
          kind="empty"
          icon={ICONS.siteHealth}
          heading="Run your first site crawl"
          description="Crawl your site to see page health, issues, and recommendations as results arrive."
          action={
            <Button variant="primary" onClick={start.onStart} disabled={start.pending}>
              {start.pending ? 'Starting…' : 'Run new crawl'}
            </Button>
          }
        />
      ) : (
        <QueryState
          kind="empty"
          icon={ICONS.siteHealth}
          heading="No site crawl yet"
          description="Page health, issues, and recommendations appear here once a crawl runs."
        />
      )}
    </div>
  );
}
