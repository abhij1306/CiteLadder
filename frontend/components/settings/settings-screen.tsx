import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IntegrationSettings } from '@/components/settings/integration-settings';
import { McpConnections } from '@/components/settings/mcp-connections';
import { ApiKeys } from '@/components/settings/api-keys';
import { ProviderSettings } from '@/components/settings/provider-settings';
import { TimeZoneSetting } from '@/components/settings/time-zone-setting';
import { TabPanel, TabRail, TabsRoot } from '@/components/ui/tabs';
import { SettingsPage } from '@/components/templates/settings-page';
import { Trash2 } from '@/lib/icons';
import { projectMutations } from '@/lib/api/projects';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { useSelectProject, workspaceDestination } from '@/lib/navigation/project-destination';
import { SETTINGS_TABS, type SettingsTab } from '@/lib/settings/tabs';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { textRole } from '@/components/ui/typography';
import { Icon } from '@/components/ui/icon';
import { SettingRow, SettingRows, SettingsGroup } from '@/components/ui/setting-row';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

/** The API keys tab shows only when the user may manage credentials. */
function visibleTabs(hasWorkspace: boolean, managesCredentials: boolean) {
  return SETTINGS_TABS.filter(
    (tab) =>
      tab.value === 'general' || (hasWorkspace && (tab.value !== 'api-keys' || managesCredentials)),
  );
}

const SETTINGS_TAB_CODEC = stringUrlCodec(
  SETTINGS_TABS.map((tab) => tab.value),
  'general' as SettingsTab,
);

function ProjectDeletionControls() {
  const router = useNavigate();
  const { activeProject, activeWorkspaceId } = useProjectContext();
  const selectProject = useSelectProject();
  const mayDelete = useWorkspaceCapability('delete_projects');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMutation = useMutation(projectMutations.remove(activeWorkspaceId));
  const deleteProject = (projectId: string) =>
    deleteMutation.mutate(projectId, {
      onSuccess: (remaining, deletedId) => {
        const next = remaining.find((project) => project.id !== deletedId) ?? null;
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
      <SettingsGroup title="Delete project">
        {deleteMutation.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(deleteMutation.error, { action: 'delete the project' })}
          />
        ) : null}
        {activeProject ? (
          <SettingRows>
            <SettingRow
              label={activeProject.name}
              action={
                <Button
                  variant="danger"
                  onClick={() => setConfirmOpen(true)}
                  disabled={deleteMutation.isPending}
                >
                  <Icon icon={Trash2} />
                  Delete project
                </Button>
              }
            />
          </SettingRows>
        ) : (
          <StateBlock kind="empty" inline message="No project is selected." />
        )}
      </SettingsGroup>
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
              variant="danger"
              onClick={() => activeProject && deleteProject(activeProject.id)}
              disabled={deleteMutation.isPending || !activeProject}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete project'}
            </Button>
          </>
        }
      >
        <p className={textRole('body', 'text-ink-2')}>
          Deletes its prompts, topics, audits, visibility history and generated content. Cannot be
          undone.
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
  const activeTab = tabs.some((tab) => tab.value === requestedTab) ? requestedTab : 'general';

  return (
    <TabsRoot value={activeTab} onValueChange={setActiveTab} orientation="vertical">
      <SettingsPage rail={<TabRail items={tabs} ariaLabel="Settings sections" />}>
        <TabPanel value="general" forceMount className="focus-ring data-[state=inactive]:hidden">
          <TimeZoneSetting />
          <ProjectDeletionControls />
        </TabPanel>

        <TabPanel value="providers" forceMount className="focus-ring data-[state=inactive]:hidden">
          <ProviderSettings />
        </TabPanel>

        <TabPanel value="integrations" className="focus-ring">
          <IntegrationSettings />
        </TabPanel>
        <TabPanel value="connections" className="focus-ring">
          <McpConnections />
        </TabPanel>
        <TabPanel value="api-keys" className="focus-ring">
          <ApiKeys />
        </TabPanel>
      </SettingsPage>
    </TabsRoot>
  );
}
