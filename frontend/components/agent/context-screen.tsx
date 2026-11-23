import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AgentInstructionsCard, useAgentInstructions } from '@/components/agent/agent-instructions';
import { BrandAliasesPanel } from '@/components/knowledge-base/brand-aliases-panel';
import { BrandFactsPanel } from '@/components/knowledge-base/brand-facts-panel';
import { ProjectThemesPanel } from '@/components/knowledge-base/project-themes-panel';
import {
  CompanyFactsCard,
  TrackedCompetitorsCard,
} from '@/components/knowledge-base/brand-profile-cards';
import { BusinessMapTab } from '@/components/knowledge-base/business-map-tab';
import { useBusinessDraft } from '@/components/knowledge-base/use-business-draft';
import {
  useBrandProfileForm,
  type BrandProfileForm,
} from '@/components/knowledge-base/use-brand-profile-form';
import { SettingsPage } from '@/components/templates/settings-page';
import { TabPanel, TabRail, TabsRoot } from '@/components/ui/tabs';
import { readErrorProps } from '@/components/ui/notice';
import { projectQueries } from '@/lib/api/projects';
import type { BrandProfile, Project } from '@citeladder/contracts';
import { CONTEXT_TABS, type ContextTab } from '@/lib/agent/context-tabs';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { useBrandFacts } from '@/lib/project/use-brand-facts';
import { StateBlock } from '@/components/ui/state-block';
import { SettingsGroup } from '@/components/ui/setting-row';

type ProfileRead = UseQueryResult<BrandProfile>;

const CONTEXT_TAB_CODEC = stringUrlCodec<ContextTab>(
  CONTEXT_TABS.map((tab) => tab.value),
  'facts',
);

export function ContextScreen() {
  const { workspaceId, project } = useProjectScope();
  return <ContextWorkspace workspaceId={workspaceId} project={project} />;
}

function ContextWorkspace({
  workspaceId,
  project,
}: Readonly<{ workspaceId: string; project: Project }>) {
  const [requestedTab, setTab] = useUrlState('tab', CONTEXT_TAB_CODEC);
  const profile = useQuery(projectQueries.brandProfile({ workspaceId, projectId: project.id }));
  const facts = useBrandFacts();
  const form = useBrandProfileForm({
    projectId: project.id,
    workspaceId,
    profile: profile.data,
  });
  const instructions = useAgentInstructions(workspaceId, project.id);
  const business = useBusinessDraft({ workspaceId, projectId: project.id });

  return (
    <TabsRoot value={requestedTab} onValueChange={setTab} orientation="vertical">
      <SettingsPage rail={<TabRail items={CONTEXT_TABS} ariaLabel="Context sections" />}>
        <ContextPanels
          project={project}
          workspaceId={workspaceId}
          profile={profile}
          form={form}
          brandFacts={<BrandFactsTab facts={facts} workspaceId={workspaceId} project={project} />}
          instructions={<AgentInstructionsCard instructions={instructions} />}
          businessMap={
            <BusinessMapTab business={business} projectId={project.id} workspaceId={workspaceId} />
          }
        />
      </SettingsPage>
    </TabsRoot>
  );
}

function ContextPanels({
  project,
  workspaceId,
  profile,
  form,
  brandFacts,
  instructions,
  businessMap,
}: Readonly<{
  project: Project;
  workspaceId: string;
  profile: ProfileRead;
  form: BrandProfileForm;
  brandFacts: ReactNode;
  instructions: ReactNode;
  businessMap: ReactNode;
}>) {
  const mayEdit = useWorkspaceCapability('write');
  return (
    <>
      <TabPanel value="facts">
        {profile.data ? <CompanyFactsCard form={form} /> : <ProfileState profile={profile} />}
      </TabPanel>
      <TabPanel value="themes">
        <SettingsGroup title="Themes">
          <ProjectThemesPanel scope={{ workspaceId, projectId: project.id }} mayEdit={mayEdit} />
        </SettingsGroup>
      </TabPanel>
      <TabPanel value="map">{businessMap}</TabPanel>
      <TabPanel value="competitors">
        <TrackedCompetitorsCard project={project} />
      </TabPanel>
      <TabPanel value="brand-facts">{brandFacts}</TabPanel>
      <TabPanel value="instructions">{instructions}</TabPanel>
    </>
  );
}

function ProfileState({ profile }: Readonly<{ profile: ProfileRead }>) {
  if (profile.isPending)
    return (
      <StateBlock
        kind="loading"
        label="Loading company facts…"
        shape={{ kind: 'facts', rows: 5 }}
      />
    );
  return (
    <StateBlock
      kind="error"
      {...readErrorProps(profile)}
      title="Couldn't load company facts"
      fallback="Company facts could not be loaded."
    />
  );
}

function BrandFactsTab({
  facts,
  workspaceId,
  project,
}: Readonly<{
  facts: ReturnType<typeof useBrandFacts>;
  workspaceId: string;
  project: Project;
}>) {
  const mayEdit = useWorkspaceCapability('write');
  return (
    <>
      <BrandAliasesPanel project={project} mayEdit={mayEdit} />
      <BrandFactsSection
        facts={facts}
        workspaceId={workspaceId}
        projectId={project.id}
        mayEdit={mayEdit}
      />
    </>
  );
}

function BrandFactsSection({
  facts,
  workspaceId,
  projectId,
  mayEdit,
}: Readonly<{
  facts: ReturnType<typeof useBrandFacts>;
  workspaceId: string;
  projectId: string;
  mayEdit: boolean;
}>) {
  if (facts.isPending)
    return <StateBlock kind="loading" label="Loading brand facts…" shape={{ kind: 'list' }} />;
  if (!facts.isError && !facts.data?.enabled) return null;
  return (
    <SettingsGroup title="Brand facts">
      {facts.data?.enabled ? (
        <BrandFactsPanel
          workspaceId={workspaceId}
          projectId={projectId}
          list={facts.data}
          mayEdit={mayEdit}
        />
      ) : (
        <StateBlock
          kind="error"
          {...readErrorProps(facts)}
          title="Couldn't load brand facts"
          fallback="Brand facts could not be loaded."
        />
      )}
    </SettingsGroup>
  );
}
