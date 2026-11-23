import { WorkspaceScope } from '../db/workspace-scope.ts';
import { listCandidates } from '../prompts/candidates.ts';
import { listPromptSets, scopedPromptSet } from '../prompts/prompt-sets.ts';
import { pageOf } from './data.ts';
import type { Evidence, ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };

export async function promptSets({ db, scope }: ProjectRead, args: Page): Promise<Evidence> {
  const sets = await listPromptSets(db, scope.workspaceId, scope.projectId);
  const page = pageOf(
    sets.map((set) => ({
      id: set.id,
      name: set.name,
      kind: set.kind,
      description: set.description ?? null,
      prompt_count: set.prompt_count ?? set.prompts.length,
      created_at: set.created_at,
    })),
    args,
    { endpoint: 'mcp_prompt_sets', filters: { project_id: scope.projectId } },
  );
  return { state: 'available', view: 'sets', items: page.items, pagination: page.pagination };
}

async function projectSetIds({ db, scope }: ProjectRead, selected: string | null | undefined) {
  if (selected)
    return [(await scopedPromptSet(db, scope.workspaceId, selected, scope.projectId)).id];
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .innerJoin('prompt_sets as s', 's.project_id', 'projects.id')
    .select('s.id')
    .where('projects.id', '=', scope.projectId)
    .orderBy('s.created_at')
    .orderBy('s.id')
    .execute();
  return rows.map((row) => row.id);
}

export async function promptCandidates(
  read: ProjectRead,
  args: Page & { prompt_set_id?: string | null; cohort?: string | null; intent?: string | null },
): Promise<Evidence> {
  const setIds = await projectSetIds(read, args.prompt_set_id);
  const staged = await Promise.all(
    setIds.map((id) => listCandidates(read.db, read.scope.workspaceId, id)),
  );
  const page = pageOf(
    staged
      .flat()
      .filter((candidate) => !args.cohort || candidate.cohort === args.cohort)
      .filter((candidate) => !args.intent || candidate.intent === args.intent)
      .map((candidate) => ({
        id: candidate.id,
        prompt_set_id: candidate.prompt_set_id,
        topic_id: candidate.topic_id,
        text: candidate.text,
        intent: candidate.intent,
        buyer_stage: candidate.buyer_stage,
        cohort: candidate.cohort,
        quality_status: candidate.quality_status,
        quality_flags: candidate.quality_flags,
        expires_at: candidate.expires_at,
      })),
    args,
    {
      endpoint: 'mcp_prompt_candidates',
      filters: {
        project_id: read.scope.projectId,
        prompt_set_id: args.prompt_set_id ?? null,
        cohort: args.cohort ?? null,
        intent: args.intent ?? null,
      },
    },
  );
  return {
    state: 'available',
    view: 'candidates',
    items: page.items,
    pagination: page.pagination,
  };
}
