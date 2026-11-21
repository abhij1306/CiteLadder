import { Drawer } from '@/components/ui/drawer';
import type { TrafficTableScope } from '@/lib/api/ai-traffic';
import { TrafficPages } from './pages-view';

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
