'use client';

import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { Dialog } from '@/components/ui/dialog';
import { IntegrationSettings } from '@/components/settings/integration-settings';
import { McpConnections } from '@/components/settings/mcp-connections';
import { ApiKeys } from '@/components/settings/api-keys';
import { ProviderSettings } from '@/components/settings/provider-settings';
import { TimeZoneSetting } from '@/components/settings/time-zone-setting';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import { ListScreen } from '@/components/layout/page-shell';
import { projectMutations } from '@/lib/api/projects';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { useSelectProject, workspaceDestination } from '@/lib/navigation/project-destination';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { textRole } from '@/components/ui/typography';
import { SettingsSection, SettingsSections } from '@/components/ui/settings-section';
import { Icon } from '@/components/ui/icon';
import { IdentityRow } from '@/components/ui/workspace';

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
      <SettingsSection
        title="Danger zone"
        description="Permanently delete the active project and everything inside it."
      >
        {activeProject ? (
          <>
            <IdentityRow
              media={
                <BrandMark
                  name={activeProject.brand_name}
                  logoUrl={activeProject.brand?.logo_url}
                  websiteUrl={activeProject.website_url}
                  placement="header"
                />
              }
              title={<div className={textRole('itemTitle', 'truncate')}>{activeProject.name}</div>}
              caption={<p className="type-caption">Brand: {activeProject.brand_name}</p>}
              actions={
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
            <Callout tone="negative">
              Deleting a project removes all of its prompts, topics, audits, visibility history, and
              generated content. This cannot be undone.
            </Callout>
            {deleteMutation.isError ? (
              <MutationNotice
                notice={mutationNoticeForError(deleteMutation.error, {
                  action: 'delete the project',
                })}
              />
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
              variant="danger"
              onClick={() => activeProject && deleteProject(activeProject.id)}
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
        tabs={{
          items: tabs.map((tab) => ({ value: tab.id, label: tab.label })),
          ariaLabel: 'Settings sections',
        }}
      >
        <TabPanel value="general" forceMount className="focus-ring data-[state=inactive]:hidden">
          {/* One card per section, the danger zone last. */}
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
