import { Drawer } from '@/components/ui/drawer';
import type { TrafficTableScope } from '@/lib/api/ai-traffic';
import { TrafficPages } from './pages-view';

/**
 * The paths one crawler requested, in a drawer over the Crawlers table. The
 * table pages in place like every other cursor table: its rows and pager stay
 * while the next page loads.
 */
export function CrawlerPages({
  botId,
  onClose,
  workspaceId,
  projectId,
  filters,
}: TrafficTableScope & Readonly<{ botId: string | null; onClose: () => void }>) {
  return (
    <Drawer
      open={!!botId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Observed crawler pages"
      description="Joinable path observations for the selected crawler."
    >
      {botId ? (
        <TrafficPages
          workspaceId={workspaceId}
          projectId={projectId}
          filters={{ ...filters, bot_id: botId }}
        />
      ) : null}
    </Drawer>
  );
}
