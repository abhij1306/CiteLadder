import {
  AiTrafficView,
  KeywordRowsView,
  SiteHealthView,
} from '@/components/agent/thread-views-data';
import { RankingView, SourcesView, TrendView } from '@/components/agent/thread-views-visibility';
import { Stack } from '@/components/ui/layout';
import type { AgentMessage } from '@/lib/api/agent';

type View = AgentMessage['views'][number];
type Scope = Readonly<{ workspaceId: string; projectId: string }>;

function ThreadView({ scope, view }: Readonly<{ scope: Scope; view: View }>) {
  switch (view.kind) {
    case 'visibility_trend':
      return <TrendView scope={scope} view={view} />;
    case 'visibility_ranking':
      return <RankingView scope={scope} view={view} />;
    case 'visibility_sources':
      return <SourcesView scope={scope} view={view} />;
    case 'site_health_summary':
      return <SiteHealthView scope={scope} view={view} />;
    case 'ai_traffic_overview':
      return <AiTrafficView scope={scope} view={view} />;
    case 'keyword_research_rows':
      return <KeywordRowsView scope={scope} view={view} />;
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}

export function ThreadViews({ scope, views }: Readonly<{ scope: Scope; views: readonly View[] }>) {
  if (views.length === 0) return null;
  return (
    <Stack gap="workspace" className="min-w-0">
      {views.map((view) => (
        <ThreadView key={JSON.stringify(view)} scope={scope} view={view} />
      ))}
    </Stack>
  );
}
