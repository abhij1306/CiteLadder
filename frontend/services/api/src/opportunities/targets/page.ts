/** An owned page: every finding on one URL (`www.` and slash variants alike) is one Action. */
import { normalizeDomain } from '../../analysis/domains.ts';
import { normalizedUrlForCompare } from '../../analysis/url-compare.ts';
import { resolveOwnedPages } from '../../demand/page-equivalence.ts';
import { isContentPage } from '../../page-documents/target.ts';
import { ActionTargetError, type AgentNamedTargetModule, type TargetAction } from './kind.ts';
import { cappedPages, evidencePages, ownedPages } from './shared.ts';

export const pageKey = (url: string) => `page:${normalizedUrlForCompare(url)}`;

/** The page a page Action is about; null for any other Action. */
export const actionPageUrl = (action: Pick<TargetAction, 'target_kind' | 'target_url'>) =>
  action.target_kind === 'page' ? action.target_url : null;

export const pageTarget: AgentNamedTargetModule<'page'> = {
  kind: 'page',
  async named({ db, scope, website, text }) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new ActionTargetError('Page target must be an absolute URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new ActionTargetError('Invalid page target');
    const owned = await db
      .selectFrom('owned_domains as d')
      .innerJoin('projects as p', 'p.id', 'd.project_id')
      .select('d.domain')
      .where('p.workspace_id', '=', scope.workspaceId)
      .where('p.id', '=', scope.projectId)
      .execute();
    const hosts = new Set([website, ...owned.map((row) => row.domain)].map(normalizeDomain));
    if (!hosts.has(normalizeDomain(url.hostname)))
      throw new ActionTargetError('Page target is outside the owned domains');
    return { key: pageKey(text), url: text };
  },
  async declarationTargets({ db, action, members, website }) {
    const selected = await ownedPages(db, action, evidencePages(members));
    // No finding names a crawled page: the Action's own URL, when it resolves to one.
    if (!selected.length && action.target_url) {
      const pages = await resolveOwnedPages(
        db,
        action.workspace_id,
        action.project_id,
        [action.target_url],
        website,
      );
      const resolved = pages.get(action.target_url);
      if (!resolved?.site_url_id || !['exact', 'resolved'].includes(resolved.outcome))
        return { resolved: false, reason: 'Implementation target is ambiguous or unresolved' };
      selected.push(resolved.site_url_id);
    }
    return cappedPages(selected);
  },
  async detail({ db, action }) {
    // A page Action on one of the latest crawl's content pages opens the page workspace (E3).
    const editable =
      action.target_url !== null &&
      (await isContentPage(
        db,
        { workspaceId: action.workspace_id, projectId: action.project_id },
        action.target_url,
      ));
    return { editable_page: editable, cohort: null };
  },
  agentContext: async () => ({}),
};
