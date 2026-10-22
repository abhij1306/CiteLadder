'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IntegrationSettings } from '@/components/settings/integration-settings';
import { McpConnections } from '@/components/settings/mcp-connections';
import { ApiKeys } from '@/components/settings/api-keys';
import { ProviderSettings } from '@/components/settings/provider-settings';
import { TimeZoneSetting } from '@/components/settings/time-zone-setting';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import { ListScreen } from '@/components/layout/page-shell';
import { projectsApi } from '@/lib/api/projects';
import { humanizeApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { useSelectProject, workspaceDestination } from '@/lib/navigation/project-destination';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { textRole } from '@/components/ui/typography';
import { SettingsSection, SettingsSections } from '@/components/settings/settings-section';

const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Providers' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'connections', label: 'MCP connections' },
  { id: 'api-keys', label: 'API keys' },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/** The API keys tab shows only when the user may manage credentials. */
function visibleTabs(hasWorkspace: boolean, managesCredentials: boolean) {
  return SETTINGS_TABS.filter(
    (tab) =>
      tab.id === 'general' || (hasWorkspace && (tab.id !== 'api-keys' || managesCredentials)),
  );
}

const SETTINGS_TAB_CODEC = stringUrlCodec(
  SETTINGS_TABS.map((tab) => tab.id),
  'general' as SettingsTab,
);

function ProjectDeletionControls() {
  const router = useNavigate();
  const queryClient = useQueryClient();
  const { activeProject, activeWorkspaceId } = useProjectContext();
  const selectProject = useSelectProject();
  const mayDelete = useWorkspaceCapability('delete_projects');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: (projectId: string) =>
      projectsApi.deleteProject(projectId, { workspaceId: activeWorkspaceId }),
    onSuccess: async (_data, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      const refreshedProjects = await queryClient.fetchQuery({
        queryKey: queryKeys.projects.list(String(activeWorkspaceId)),
        queryFn: ({ signal }) =>
          projectsApi.listProjects({ signal, workspaceId: activeWorkspaceId }),
      });
      const next = refreshedProjects.find((project) => project.id !== deletedId) ?? null;
      if (next) {
        // Navigate, do not merely re-select: the deleted id may be the one in
        // `?project=`, and leaving it there would resolve to a project that no
        // longer exists and present as "that project is unavailable". Replace
        // rather than push for the same reason — Back must not return to it.
        selectProject(next.id, { replace: true });
        setConfirmOpen(false);
      } else {
        router(
          activeWorkspaceId
            ? workspaceDestination('/onboarding', null, activeWorkspaceId)
            : '/onboarding',
          { replace: true },
        );
      }
    },
  });

  // Only a role that may delete (Owner/Admin) sees the control.
  if (!mayDelete) return null;
  return (
    <>
      <SettingsSection
        title="Danger zone"
        description="Permanently delete the active project and everything inside it."
      >
        {activeProject ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <BrandLogo
                  name={activeProject.brand_name}
                  logoUrl={activeProject.brand?.logo_url}
                  websiteUrl={activeProject.website_url}
                  placement="identity"
                />
                <div className="grid min-w-0 gap-0.5">
                  <div className={textRole('itemTitle', 'truncate')}>{activeProject.name}</div>
                  <p className="type-caption">Brand: {activeProject.brand_name}</p>
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="size-4 shrink-0" aria-hidden />
                Delete project
              </Button>
            </div>
            <Alert tone="danger">
              Deleting a project removes all of its prompts, topics, audits, visibility history, and
              generated content. This cannot be undone.
            </Alert>
            {deleteMutation.isError ? (
              <Alert tone="danger">{humanizeApiError(deleteMutation.error).message}</Alert>
            ) : null}
          </>
        ) : (
          <p className="type-body">No project selected.</p>
        )}
      </SettingsSection>
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!deleteMutation.isPending) setConfirmOpen(open);
        }}
        title="Delete project"
        description={activeProject ? `Delete "${activeProject.name}"?` : undefined}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => activeProject && deleteMutation.mutate(activeProject.id)}
              disabled={deleteMutation.isPending || !activeProject}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete project'}
            </Button>
          </>
        }
      >
        <p className={textRole('body')}>
          This permanently deletes the project and all of its prompts, topics, audits, visibility
          history, and generated content. This cannot be undone.
        </p>
      </Dialog>
    </>
  );
}

/**
 * SettingsScreen — tabbed settings (General / Providers / Integrations / MCP
 * connections / API keys), following the WAI-ARIA tabs idiom used by the
 * Visibility workspace (roving tabindex, Arrow/Home/End navigation,
 * `aria-selected`, labelled panels).
 *
 * - **General**: display timezone and deleting the active project.
 * - **Providers**: the BYOK answer-engine configuration, rendered by
 *   `ProviderSettings`.
 * - **Integrations**: first-party data connections (GSC/GA4 on one shared
 *   Google OAuth grant, Bing on a Microsoft grant), rendered by
 *   `IntegrationSettings`. `?tab=integrations` is the OAuth-callback landing
 *   surface (contract C2).
 */
export function SettingsScreen() {
  // Deep-linkable initial tab (`/settings?tab=providers` from the onboarding
  // card); invalid/absent values fall back to General.
  const [requestedTab, setActiveTab] = useUrlState('tab', SETTINGS_TAB_CODEC);
  const { activeWorkspace } = useProjectContext();
  const managesCredentials = useWorkspaceCapability('manage_credentials');
  const tabs = visibleTabs(activeWorkspace !== null, managesCredentials);
  // `?tab=` is deep-linkable, so someone can arrive asking for a tab that is
  // not offered. Fall back to General rather than selecting
  // a tab that no longer exists, which would leave no panel visible at all.
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'general';

  return (
    <TabsRoot value={activeTab} onValueChange={setActiveTab}>
      <ListScreen
        measure="workflow"
        tabs={{
          items: tabs.map((tab) => ({ value: tab.id, label: tab.label })),
          ariaLabel: 'Settings sections',
        }}
      >
        <TabPanel value="general" forceMount className="focus-ring data-[state=inactive]:hidden">
          <SettingsSections>
            <TimeZoneSetting />
            <ProjectDeletionControls />
          </SettingsSections>
        </TabPanel>

        <TabPanel value="providers" forceMount className="focus-ring data-[state=inactive]:hidden">
          <ProviderSettings />
        </TabPanel>

        {/* Not forceMount, unlike its siblings. This panel owns a connection
            list that fans out into a mappings query and a 3s backfill poll per
            connection, so mounting it behind every other tab meant opening
            Profile issued five integration requests and then polled a backfill
            the reader could not see. */}
        <TabPanel value="integrations" className="focus-ring">
          <IntegrationSettings />
        </TabPanel>
        <TabPanel value="connections" className="focus-ring">
          <McpConnections />
        </TabPanel>
        <TabPanel value="api-keys" className="focus-ring">
          <ApiKeys />
        </TabPanel>
      </ListScreen>
    </TabsRoot>
  );
}
