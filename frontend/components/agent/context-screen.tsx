'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import type { ReactNode } from 'react';

import { AgentInstructionsCard, useAgentInstructions } from '@/components/agent/agent-instructions';
import { BrandFactsPanel } from '@/components/knowledge-base/brand-facts-panel';
import {
  AudienceCard,
  CompanyFactsCard,
  ProfileSaveNotices,
  TrackedCompetitorsCard,
} from '@/components/knowledge-base/brand-profile-cards';
import { BusinessMapSummary } from '@/components/knowledge-base/business-map-summary';
import {
  useBrandProfileForm,
  type BrandProfileForm,
} from '@/components/knowledge-base/use-brand-profile-form';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { CompetitorSuggestions } from '@/components/visibility/prompt-insights';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import type { BrandProfile, Project } from '@/lib/api/types';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { useBrandFacts } from '@/lib/project/use-brand-facts';

const CONTEXT_TABS = [
  // Short labels: six tabs share one row on the owner's 982px desktop.
  { id: 'facts', label: 'Company' },
  { id: 'audience', label: 'Audience & Offerings' },
  { id: 'map', label: 'Business map' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'brand-facts', label: 'Brand facts' },
  { id: 'instructions', label: 'Agent instructions' },
] as const;

type ContextTab = (typeof CONTEXT_TABS)[number]['id'];
type ProfileRead = UseQueryResult<BrandProfile>;

const CONTEXT_TAB_CODEC = stringUrlCodec<ContextTab>(
  CONTEXT_TABS.map((tab) => tab.id),
  'facts',
);

/** Which save the identity band offers on each tab; read-only tabs offer none. */
const TAB_SAVE: Readonly<Record<ContextTab, 'profile' | 'instructions' | null>> = {
  facts: 'profile',
  audience: 'profile',
  map: null,
  competitors: null,
  'brand-facts': null,
  instructions: 'instructions',
};

/**
 * What the agent knows about the business before it reads any evidence, one
 * tab per subject: the company facts, audience and offerings, the read-only
 * business map the Prompt Builder edits, the tracked competitors, the pilot's
 * Brand facts, and the project's Agent instructions. Each tab's content sits
 * on a card; the identity band carries the active tab's save.
 */
export function ContextScreen() {
  const { activeProject, activeWorkspaceId } = useProjectContext();
  if (!activeProject || !activeWorkspaceId)
    return (
      <ListScreen measure="workflow">
        <ProjectRequiredState />
      </ListScreen>
    );
  // Keyed by project so an unsaved draft never carries to another project.
  return (
    <ContextWorkspace
      key={activeProject.id}
      workspaceId={activeWorkspaceId}
      project={activeProject}
    />
  );
}

function ContextWorkspace({
  workspaceId,
  project,
}: Readonly<{ workspaceId: string; project: Project }>) {
  const queryClient = useQueryClient();
  const [requestedTab, setTab] = useUrlState('tab', CONTEXT_TAB_CODEC);
  const profile = useQuery({
    queryKey: queryKeys.projects.brandProfile(project.id),
    queryFn: ({ signal }) => projectsApi.getBrandProfile(project.id, { signal, workspaceId }),
  });
  // The pilot gate is known before the tabs render, so its tab never appears
  // late. Outside the pilot there is no tab; an unreadable gate shows its error there.
  const facts = useBrandFacts(project.id, workspaceId);
  const form = useBrandProfileForm({
    projectId: project.id,
    workspaceId,
    profile: profile.data,
    onSaved: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.commandCenter(project.id),
      }),
  });
  const instructions = useAgentInstructions(workspaceId, project.id);
  const offersBrandFacts = facts.isError || Boolean(facts.data?.enabled);
  const tabs = CONTEXT_TABS.filter((tab) => tab.id !== 'brand-facts' || offersBrandFacts);
  // `?tab=` is deep-linkable, so a link can ask for a tab this project does not offer.
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'facts';
  const saveKind = TAB_SAVE[activeTab];

  return (
    <TabsRoot value={activeTab} onValueChange={setTab}>
      <ListScreen
        measure="workflow"
        tabs={
          facts.isPending
            ? undefined
            : {
                items: tabs.map((tab) => ({ value: tab.id, label: tab.label })),
                ariaLabel: 'Context sections',
              }
        }
        actions={
          <SaveAction
            kind={saveKind === 'profile' && !profile.data ? null : saveKind}
            form={form}
            instructions={instructions}
          />
        }
      >
        {facts.isPending ? (
          <QueryState kind="loading" label="Loading company facts…" />
        ) : (
          <ContextPanels
            project={project}
            workspaceId={workspaceId}
            profile={profile}
            form={form}
            brandFacts={
              <BrandFactsTab facts={facts} workspaceId={workspaceId} projectId={project.id} />
            }
            instructions={<AgentInstructionsCard instructions={instructions} />}
          />
        )}
      </ListScreen>
    </TabsRoot>
  );
}

/**
 * One save button in the identity band for every tab, so switching tabs never
 * moves the band: a tab with nothing to save keeps the button's box, hidden.
 */
function SaveAction({
  kind,
  form,
  instructions,
}: Readonly<{
  kind: 'profile' | 'instructions' | null;
  form: BrandProfileForm;
  instructions: ReturnType<typeof useAgentInstructions>;
}>) {
  if (kind === 'instructions' && instructions.mayEdit)
    return (
      <Button variant="primary" onClick={instructions.save} disabled={!instructions.canSave}>
        <Icon icon={Save} />
        Save instructions
      </Button>
    );
  const hidden = kind !== 'profile';
  return (
    <Button
      variant="primary"
      className={hidden ? 'invisible' : undefined}
      aria-hidden={hidden || undefined}
      onClick={form.save}
      disabled={hidden || form.saving}
    >
      <Icon icon={Save} />
      {form.saving ? 'Saving…' : 'Save brand knowledge'}
    </Button>
  );
}

function ContextPanels({
  project,
  workspaceId,
  profile,
  form,
  brandFacts,
  instructions,
}: Readonly<{
  project: Project;
  workspaceId: string;
  profile: ProfileRead;
  form: BrandProfileForm;
  brandFacts: ReactNode;
  instructions: ReactNode;
}>) {
  const suggestions = useQuery({
    queryKey: queryKeys.visibility.competitorSuggestions(project.id),
    queryFn: ({ signal }) =>
      visibilityApi.listCompetitorSuggestions(project.id, { signal, workspaceId }),
  });
  return (
    <>
      <TabPanel value="facts">
        <ProfileTab profile={profile} form={form}>
          <CompanyFactsCard form={form} />
        </ProfileTab>
      </TabPanel>
      <TabPanel value="audience">
        <ProfileTab profile={profile} form={form}>
          <AudienceCard form={form} />
        </ProfileTab>
      </TabPanel>
      <TabPanel value="map">
        {profile.data ? (
          <BusinessMapSummary
            projectId={project.id}
            workspaceId={workspaceId}
            profile={profile.data}
          />
        ) : (
          <ProfileState profile={profile} />
        )}
      </TabPanel>
      <TabPanel value="competitors">
        <Stack gap="workspace">
          <TrackedCompetitorsCard project={project} />
          <CompetitorSuggestions projectId={project.id} suggestionsQuery={suggestions} />
        </Stack>
      </TabPanel>
      <TabPanel value="brand-facts">{brandFacts}</TabPanel>
      <TabPanel value="instructions">{instructions}</TabPanel>
    </>
  );
}

/** A tab the profile save covers: its notices above its card, once the profile is read. */
function ProfileTab({
  profile,
  form,
  children,
}: Readonly<{
  profile: ProfileRead;
  form: BrandProfileForm;
  children: ReactNode;
}>) {
  if (!profile.data) return <ProfileState profile={profile} />;
  return (
    <Stack gap="workspace">
      <ProfileSaveNotices form={form} />
      {children}
    </Stack>
  );
}

/** The profile's loading or read error, in the one query-state footprint. */
function ProfileState({ profile }: Readonly<{ profile: ProfileRead }>) {
  if (profile.isPending) return <QueryState kind="loading" label="Loading company facts…" />;
  return (
    <QueryState
      kind="error"
      {...readErrorProps(profile)}
      fallback="Company facts could not be loaded."
    />
  );
}

/**
 * Brand facts answers are checked against, on their own tab; shown only
 * inside the fact-checking pilot, or with the gate's read error.
 */
function BrandFactsTab({
  facts,
  workspaceId,
  projectId,
}: Readonly<{
  facts: ReturnType<typeof useBrandFacts>;
  workspaceId: string;
  projectId: string;
}>) {
  const mayEdit = useWorkspaceCapability('write');
  return (
    <Card aria-labelledby="brand-facts">
      <CardHeader>
        <CardTitle id="brand-facts">Brand facts</CardTitle>
        <CardDescription>
          Statements of record that AI answers about you are checked against. Runs check the facts
          confirmed when they start.
        </CardDescription>
      </CardHeader>
      {facts.data?.enabled ? (
        <BrandFactsPanel
          workspaceId={workspaceId}
          projectId={projectId}
          list={facts.data}
          mayEdit={mayEdit}
        />
      ) : (
        <QueryState
          kind="error"
          {...readErrorProps(facts)}
          fallback="Brand facts could not be loaded."
        />
      )}
    </Card>
  );
}
