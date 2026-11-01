/**
 * Topic preview: the Prompt Builder's buyer-facing topic proposals for a
 * project, beside the topics it already has. One metered model call, spent
 * from the same topic-call reservation generation's recovery uses; nothing is
 * written. Confirming a proposal creates it through the topic owner
 * (`confirmTopics`), which records the offerings it covers.
 */
import type { topicPreviewResponseSchema } from '@citeladder/contracts/project';
import type { z } from 'zod';

import { agentCallLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { meterFor, type Meter } from '../billing/metering.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { createModelGateway, type ModelGateway } from '../models/gateway.ts';
import { topicProposalInput } from './generation-context.ts';
import { generationInvalid, generationSetting } from './generation-input.ts';
import { proposeTopics } from './topic-proposals.ts';

type Dependencies = {
  gateway: () => ModelGateway;
  meter?: (db: Database, workspaceId: string) => Meter;
  deadline?: () => AbortSignal;
};
const defaults: Dependencies = { gateway: createModelGateway };

export async function previewTopics(
  db: Database,
  workspaceId: string,
  projectId: string,
  dependencies: Dependencies = defaults,
): Promise<z.infer<typeof topicPreviewResponseSchema>> {
  const input = await db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    if (!project) throw notFound('Project');
    return topicProposalInput(trx, { workspaceId, projectId });
  });
  if (!input.offerings.length)
    throw generationInvalid('Add at least one offering before proposing topics');
  const meter = (dependencies.meter ?? meterFor)(db, workspaceId);
  const gateway = meter.gateway(dependencies.gateway(), 'prompt_generation');
  await enforceWorkspaceRequest(
    db,
    workspaceId,
    agentCallLimit(policy.prompts.generation.topic_calls),
  );
  const deadline =
    dependencies.deadline?.() ??
    AbortSignal.timeout(generationSetting('generation_deadline_seconds') * 1000);
  const proposal = await proposeTopics(input, gateway, deadline);
  return { source: proposal.source, topics: proposal.topics, overflow: proposal.overflow };
}
