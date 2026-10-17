import { z } from 'zod';
import { auditEstimateSchema } from '@citeladder/contracts/audits';
import { logicalEngineSchema } from '@citeladder/contracts/providers';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { auditPolicy, auditRuntime, type AuditRuntime } from './config.ts';
import { providerPolicy } from '../providers/config.ts';
import { resolveMarkets } from '../projects/markets.ts';
import { searchContext } from '../search-surfaces/locations.ts';
import { marketEngines } from './freeze.ts';
import { marketIdsInput } from './inputs.ts';
import { costPolicy, estimateTokens, knownTotal, previewCost } from './costs.ts';

export const estimateInput = z.object({
  project_id: z.uuid(),
  prompt_set_id: z.uuid().nullish(),
  prompt_ids: z.array(z.uuid()).default([]),
  engines: z.array(logicalEngineSchema).min(1),
  repetitions: z
    .number()
    .int()
    .min(auditPolicy.min_repetitions)
    .max(auditPolicy.max_repetitions)
    .nullish(),
  market_ids: marketIdsInput,
});
function aggregateCostStatus(statuses: ReadonlySet<string>) {
  if (statuses.size !== 1) return 'partial';
  if (statuses.has('complete')) return 'complete';
  return statuses.has('unknown') ? 'unknown' : 'partial';
}
/**
 * Provider-free preview reads accepted prompt source and versioned rates; no
 * credential or health lookup. A launch runs one audit per market, so each
 * engine's executions scale with the selected markets it can measure.
 */
export async function estimateAudit(
  db: Database,
  workspaceId: string,
  input: z.output<typeof estimateInput>,
  runtime: AuditRuntime = auditRuntime(),
) {
  const invalid = (message: string) => new ApiError(422, message);
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', input.project_id)
    .executeTakeFirst();
  if (!project) throw invalid('Project not found');
  let query = db
    .selectFrom('prompts as p')
    .innerJoin('prompt_sets as s', 's.id', 'p.prompt_set_id')
    .select(['p.id', 'p.text'])
    .where('s.project_id', '=', project.id)
    .where('p.enabled', '=', true)
    .orderBy('p.created_at')
    .orderBy('p.id');
  if (input.prompt_ids.length) query = query.where('p.id', 'in', input.prompt_ids);
  else if (input.prompt_set_id) query = query.where('s.id', '=', input.prompt_set_id);
  else throw invalid('Either prompt_set_id or prompt_ids is required');
  const prompts = await query.execute();
  if (
    !prompts.length ||
    (input.prompt_ids.length && prompts.length !== new Set(input.prompt_ids).size)
  )
    throw invalid('One or more prompts are unavailable');
  const settings = runtime.audits,
    repetitions = input.repetitions ?? settings.audit_repetitions;
  const markets = await resolveMarkets(
    db,
    { workspaceId, projectId: project.id },
    input.market_ids,
  );
  const requested = [...new Set(input.engines)];
  const measured = markets.map(
    (market) =>
      marketEngines(requested, market, searchContext(market.country_code, market.language_code))
        .engines,
  );
  const promptTokens = prompts.reduce((sum, prompt) => sum + estimateTokens(prompt.text), 0);
  const engines = requested
    .map((engine) => ({
      engine,
      marketCount: measured.filter((list) => list.includes(engine)).length,
    }))
    .filter(({ marketCount }) => marketCount > 0)
    .map(({ engine, marketCount }) => {
      const route = providerPolicy.routes[engine],
        runs = marketCount * repetitions,
        executions = prompts.length * runs,
        inputTokens = promptTokens * runs;
      const common = {
        logical_engine: engine,
        transport_provider: route.transport_provider,
        transport_model: route.transport_model,
        prompt_count: prompts.length,
        repetition_count: repetitions,
        market_count: marketCount,
        execution_count: executions,
        pricing_version: costPolicy.pricing_version,
      };
      if (route.transport_provider === 'dataforseo')
        return {
          ...common,
          retrieval_enabled: null,
          maximum_attempt_count: executions,
          estimated_input_tokens: null,
          estimated_output_tokens: null,
          estimated_search_calls: null,
          estimated_token_cost_microusd: null,
          estimated_search_cost_microusd: null,
          estimated_total_cost_microusd: null,
          cost_status: 'unknown' as const,
        };
      const calls: Record<string, number> = costPolicy.estimate_search_calls;
      if (calls[engine] === undefined)
        throw invalid(`Search-call estimate is unavailable for engine: ${engine}`);
      const outputTokens = executions * settings.audit_max_output_tokens;
      return {
        ...common,
        retrieval_enabled: true,
        maximum_attempt_count: executions * settings.max_attempts,
        estimated_input_tokens: inputTokens,
        estimated_output_tokens: outputTokens,
        ...previewCost(
          {
            logical_engine: engine,
            transport_provider: route.transport_provider,
            transport_model: route.transport_model,
          },
          { inputTokens, outputTokens, executions, retrieval: true },
        ),
      };
    });
  const attempts = engines.reduce((sum, engine) => sum + engine.maximum_attempt_count, 0);
  const statuses = new Set(engines.map((engine) => engine.cost_status));
  return auditEstimateSchema.parse({
    retrieval_enabled: true,
    prompt_count: prompts.length,
    engine_count: engines.length,
    repetition_count: repetitions,
    market_count: markets.length,
    execution_count: engines.reduce((sum, engine) => sum + engine.execution_count, 0),
    maximum_attempt_count: attempts,
    maximum_wall_clock_seconds: Math.ceil(
      input.engines.some((engine) => ['chatgpt_search', 'gemini_consumer'].includes(engine))
        ? runtime.search.recoveryDeadlineHours * 3600
        : (attempts * settings.audit_timeout_seconds) / Math.max(1, settings.worker_concurrency),
    ),
    cost_status: aggregateCostStatus(statuses),
    estimated_total_cost_microusd: knownTotal(
      engines.map((engine) => engine.estimated_total_cost_microusd),
    ),
    engines,
  });
}
