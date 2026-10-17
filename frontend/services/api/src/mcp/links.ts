/**
 * Links into the app for MCP results. Paths are the router's real screens
 * (`apps/app/src/router.tsx`); `?project=` is the shell's project hand-off.
 * In-app Agent reads have no origin and keep relative links.
 */
export function appLink(origin: string, path: string, projectId: string): string {
  const relative = `${path}?${new URLSearchParams({ project: projectId })}`;
  return origin ? new URL(relative, origin).href : relative;
}

/** The screen that shows a record kind; a record with its own page links to it. */
export function recordPath(kind: string, record: Record<string, unknown>): string {
  const text = (key: string) => (typeof record[key] === 'string' ? record[key] : '');
  switch (kind) {
    case 'action':
      return `/agent/actions/${text('id')}`;
    case 'opportunity':
      return text('action_id') ? `/agent/actions/${text('action_id')}` : '/agent/actions';
    case 'audit':
      return `/runs/${text('id')}`;
    case 'visibility_result':
      return text('audit_id') ? `/runs/${text('audit_id')}` : '/visibility';
    case 'site_page':
      return text('crawl_id') && text('site_url_id')
        ? `/site/crawls/${text('crawl_id')}/pages/${text('site_url_id')}`
        : '/site';
    case 'prompt':
      return '/prompts';
    case 'demand_snapshot':
      return '/demand';
    case 'traffic_snapshot':
    case 'query_snapshot':
    case 'query_row':
      return '/performance';
    case 'project':
      return '/visibility';
    default:
      if (kind.startsWith('site_')) return '/site';
      if (kind.startsWith('search_')) return '/search-intelligence';
      return '/visibility';
  }
}
