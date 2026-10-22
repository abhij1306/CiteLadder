'use client';

import { QueryState } from '@/components/ui/query-state';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { useProjectContext } from '@/lib/project/project-context';

import { CommerceWorkspace } from './commerce-workspace';

/**
 * Commerce is one screen, not four tabs.
 *
 * The tabs were verbs — Catalog, Competitors, Buyer Prompts, AI Shelf — and
 * each one re-asked the same noun, so the target selector was duplicated three
 * times over three selection states that never agreed. The catalog is the
 * navigation now and everything else is a view of the selected target, held in
 * `?target=`.
 */
export function ProductsScreen() {
  const { activeProject, isLoading } = useProjectContext();
  const projectId = activeProject?.id ?? '';
  if (isLoading)
    return (
      <ListScreen>
        <QueryState kind="loading" label="Loading Commerce…" />
      </ListScreen>
    );
  if (!projectId)
    return (
      <ListScreen>
        <ProjectRequiredState />
      </ListScreen>
    );
  return <CommerceWorkspace projectId={projectId} />;
}
