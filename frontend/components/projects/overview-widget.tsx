'use client';

import type { ReactNode } from 'react';

import type { OverviewWidgetKey } from '@citeladder/contracts/overview';
import type { CommandCenter, Project } from '@/lib/api/types';

import {
  CompanyFacts,
  Movement,
  NextAction,
  ProgressProofCard,
  ProjectStateCard,
  RankedActionsCard,
  Track,
} from './dashboard-sections';
import { MissingPrompts } from './missing-prompts';
import {
  AiTrafficWidget,
  PerceptionWidget,
  RetrievalWidget,
  SearchConsoleWidget,
  ShareOfVoiceWidget,
  TopMoversWidget,
  VisibilityTrendWidget,
} from './overview-library-widgets';
import type { useCommandCenterActions } from './use-command-center-actions';

type WidgetProps = {
  data: CommandCenter;
  project: Project;
  actions: ReturnType<typeof useCommandCenterActions>;
};

/** Every widget by its layout key; a key with no entry fails the type check. */
const WIDGETS: Record<OverviewWidgetKey, (props: WidgetProps) => ReactNode> = {
  project_state: ({ data }) => <ProjectStateCard data={data} />,
  citation_share: ({ data }) => <Track data={data} />,
  movement: ({ data }) => <Movement data={data} />,
  next_action: ({ data }) => <NextAction data={data} />,
  missing_prompts: ({ project }) => (
    <MissingPrompts projectId={project.id} workspaceId={project.workspace_id} />
  ),
  ranked_actions: ({ actions }) => (
    <RankedActionsCard
      actions={actions.actions}
      pending={actions.reorderPending}
      onMove={actions.move}
    />
  ),
  progress_proof: ({ data }) => <ProgressProofCard data={data} />,
  company_facts: ({ data }) => <CompanyFacts data={data} />,
  visibility_trend: ({ project }) => <VisibilityTrendWidget project={project} />,
  share_of_voice: ({ project }) => <ShareOfVoiceWidget project={project} />,
  top_movers: ({ project }) => <TopMoversWidget project={project} />,
  retrieval: ({ project }) => <RetrievalWidget project={project} />,
  perception: ({ project }) => <PerceptionWidget project={project} />,
  ai_traffic: ({ project }) => <AiTrafficWidget project={project} />,
  search_console: ({ project }) => <SearchConsoleWidget project={project} />,
};

/** One Overview widget by its layout key. */
export function OverviewWidgetView({
  widgetKey,
  ...props
}: Readonly<WidgetProps & { widgetKey: OverviewWidgetKey }>) {
  return WIDGETS[widgetKey](props);
}
