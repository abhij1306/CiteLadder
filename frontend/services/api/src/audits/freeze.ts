import { createHash, randomBytes } from 'node:crypto';
import { shuffleAuditSlots } from './slot-order.ts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  providerPolicy,
  surfaceKindOf,
  type Engine,
  type ProviderSettings,
} from '../providers/config.ts';
import { approvedEndpoint } from '../providers/connections.ts';
import { auditPolicy, auditSettings } from './config.ts';
import type { AuditInput } from './inputs.ts';
import { frozenConfiguration } from './frozen-configuration.ts';
import { freezeCatalogRevision, freezeCommerceContext } from '../commerce/audit-context.ts';
import { frozenEntityMatching, projectEntityMatching } from '../analysis/entity-matching.ts';
import { strings } from '../db/json.ts';
import { admittedFactCheck, admittedPerceptionVersions } from '../perception/admission.ts';
import { gatewaySettings } from '../models/gateway.ts';
import { marketLabel } from '@citeladder/contracts/markets';
import type { Market } from '../projects/markets.ts';
import {
  isSearchSurface,
  searchContext,
  searchLanguageOf,
  surfaceSupports,
} from '../search-surfaces/locations.ts';
import {
  searchPayload,
  searchPolicy,
  searchSettings,
  type SearchEngine,
} from '../search-surfaces/dataforseo.ts';

const invalid = (message: string) => new ApiError(400, message);
const promptSelection = (input: Pick<AuditInput, 'prompt_ids'>): 'selected' | 'set' =>
  input.prompt_ids.length ? 'selected' : 'set';
type FrozenPrompt = Awaited<ReturnType<typeof loadPrompts>>[number];

export function marketEngines(
  requested: readonly Engine[],
  market: Market,
  context: { serp_location_code: number },
) {
  const engines: Engine[] = [],
    notApplicable: Engine[] = [];
  const language = market.language_code.trim()
    ? searchLanguageOf(market.language_code)
    : searchPolicy.constants.default_language_code;
  for (const engine of requested) {
    const support = providerPolicy.routes[engine].market_support;
    if (support === 'none' && market.id !== null) notApplicable.push(engine);
    else if (
      support === 'dataforseo_location' &&
      isSearchSurface(engine) &&
      !surfaceSupports(engine, context.serp_location_code, language)
    )
      throw new ApiError(422, `${engine} cannot measure ${marketLabel(market)}`, {
        code: 'market_unsupported',
        details: {
          engine,
          country_code: market.country_code,
          language_code: market.language_code,
        },
      });
    else engines.push(engine);
  }
  if (!engines.length)
    throw new ApiError(422, `No selected engine can measure ${marketLabel(market)}`, {
      code: 'market_unsupported',
      details: {
        country_code: market.country_code,
        language_code: market.language_code,
      },
    });
  return { engines, notApplicable };
}

export function canMeasure(engine: Engine, market: Market) {
  try {
    const context = searchContext(market.country_code, market.language_code);
    return marketEngines([engine], market, context).engines.length > 0;
  } catch {
    return false;
  }
}
export type FrozenRoute = {
  logical_engine: Engine;
  transport_provider: string;
  transport_model: string;
  connection_id: string;
  base_url: string;
};
/**
 * The prompts a launch measures, shared with the estimate: the active, enabled
 * prompts in the project that the input names. The caller requires a prompt
 * set or prompt IDs.
 */
export async function launchPrompts(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: Pick<AuditInput, 'prompt_ids' | 'prompt_set_id'>,
) {
  let query = db
    .selectFrom('prompts as p')
    .innerJoin('prompt_sets as s', 's.id', 'p.prompt_set_id')
    .innerJoin('projects as project', 'project.id', 's.project_id')
    .leftJoin('topics as topic', (join) =>
      join.onRef('topic.id', '=', 'p.topic_id').onRef('topic.workspace_id', '=', 'p.workspace_id'),
    )
    .selectAll('p')
    .select('topic.name as topic_name')
    .where('project.workspace_id', '=', workspaceId)
    .where('project.id', '=', projectId)
    .where('p.enabled', '=', true)
    .where('p.status', '=', 'active')
    .orderBy('p.created_at')
    .orderBy('p.id');
  if (input.prompt_ids.length) query = query.where('p.id', 'in', input.prompt_ids);
  else if (input.prompt_set_id) query = query.where('p.prompt_set_id', '=', input.prompt_set_id);
  else return [];
  return query.execute();
}
async function loadPrompts(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: AuditInput,
  settings: ReturnType<typeof auditSettings>,
) {
  if (!input.prompt_ids.length && !input.prompt_set_id)
    throw invalid('Select a prompt set or prompt IDs');
  const prompts = await launchPrompts(db, workspaceId, projectId, input);
  if (input.prompt_ids.length && new Set(input.prompt_ids).size !== prompts.length)
    throw invalid('Selected prompts must be active, enabled and in this project');
  if (!prompts.length) throw invalid('No enabled prompts to audit');
  if (prompts.some((prompt) => Array.from(prompt.text).length > settings.max_prompt_chars))
    throw invalid('Selected prompts exceed the configured length limit');
  return prompts;
}
function assertRepetitions(repetitions: number) {
  if (
    !Number.isSafeInteger(repetitions) ||
    repetitions < auditPolicy.min_repetitions ||
    repetitions > auditPolicy.max_repetitions
  )
    throw invalid('Repetition count is outside the configured bounds');
}
type RouteCandidate = {
  logical_engine: string;
  transport_provider: string;
  base_url: string;
  paused_at: Date | null;
  pause_until: Date | null;
  last_test_status: string;
  has_key: boolean;
};
function usableCandidate(
  candidate: RouteCandidate,
  engine: Engine,
  provider: string,
  providerSettings: ProviderSettings,
  at: Date,
) {
  if (candidate.logical_engine !== engine || candidate.transport_provider !== provider)
    return false;
  if (
    !candidate.has_key ||
    candidate.last_test_status !== 'ok' ||
    (candidate.paused_at !== null && (candidate.pause_until === null || candidate.pause_until > at))
  )
    return false;
  try {
    approvedEndpoint(candidate.transport_provider, candidate.base_url, providerSettings);
    return true;
  } catch {
    return false;
  }
}
export function byokRoutes(db: Database, workspaceId: string) {
  return db
    .selectFrom('provider_routes as r')
    .innerJoin('provider_connections as c', 'c.id', 'r.connection_id')
    .select([
      'r.logical_engine',
      'r.transport_provider',
      'r.transport_model',
      'c.id as connection_id',
      'c.base_url',
      'c.paused_at',
      'c.pause_until',
      'c.last_test_status',
      sql<boolean>`c.api_key_encrypted <> ''`.as('has_key'),
    ])
    .where('r.workspace_id', '=', workspaceId)
    .where('c.workspace_id', '=', workspaceId)
    .where('c.credential_source', '=', 'byok')
    .where('r.active', '=', true)
    .where('c.active', '=', true)
    .orderBy('r.is_default', 'desc')
    .orderBy('r.created_at')
    .orderBy('r.id')
    .execute();
}
export function usableRoute<Candidate extends RouteCandidate>(
  candidates: readonly Candidate[],
  engine: Engine,
  { providerSettings, at }: { providerSettings: ProviderSettings; at: Date },
) {
  const provider = providerPolicy.routes[engine].transport_provider;
  return candidates.find((candidate) =>
    usableCandidate(candidate, engine, provider, providerSettings, at),
  );
}
type SearchProject = {
  serp_location_code: number;
  serp_language_code: string;
  serp_device: string;
};
function validateSearchRequests(
  engine: Engine,
  prompts: { text: string }[],
  project: SearchProject,
  settings: ReturnType<typeof auditSettings>,
) {
  for (const prompt of prompts)
    searchPayload(engine as SearchEngine, {
      query: prompt.text,
      location_code: project.serp_location_code,
      language_code: project.serp_language_code || searchPolicy.constants.default_language_code,
      device: project.serp_device as 'desktop' | 'mobile',
      depth: searchPolicy.constants.default_depth,
      load_async_ai_overview: searchPolicy.constants.load_async_ai_overview,
      timeout_seconds: settings.audit_timeout_seconds,
      provider_submission_ref: 'admission-validation',
      request_settings: {},
    });
}
async function freezeRoutes({
  db,
  workspaceId,
  engines,
  prompts,
  project,
  settings,
  providerSettings,
  at,
}: {
  db: Database;
  workspaceId: string;
  engines: Engine[];
  prompts: { text: string }[];
  project: SearchProject;
  settings: ReturnType<typeof auditSettings>;
  providerSettings: ProviderSettings;
  at: Date;
}) {
  const candidates = await byokRoutes(db, workspaceId);
  const routes: FrozenRoute[] = [];
  for (const engine of engines) {
    const catalog = providerPolicy.routes[engine];
    const observed = surfaceKindOf(engine) !== 'llm';
    const selected = usableRoute(candidates, engine, { providerSettings, at });
    if (!selected)
      throw new ApiError(400, `No active provider route configured for ${engine}`, {
        code: 'execution_credentials_unavailable',
      });
    routes.push({
      logical_engine: engine,
      transport_provider: catalog.transport_provider,
      transport_model: catalog.transport_model,
      connection_id: selected.connection_id,
      base_url: selected.base_url,
    });
    if (observed) validateSearchRequests(engine, prompts, project, settings);
  }
  return routes;
}
async function loadBrandContext(
  db: Database,
  {
    workspaceId,
    project,
    brand,
    auditScope,
  }: {
    workspaceId: string;
    project: { id: string };
    brand: { id: string } | undefined;
    auditScope: AuditInput['audit_scope'];
  },
) {
  const [aliases, owned, unintended, competitors, profile, factCheck] = await Promise.all([
    brand
      ? db
          .selectFrom('brand_aliases')
          .select('alias')
          .where('workspace_id', '=', workspaceId)
          .where('brand_id', '=', brand.id)
          .orderBy('id')
          .execute()
      : [],
    db
      .selectFrom('owned_domains')
      .select('domain')
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', project.id)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('unintended_domains')
      .select('domain')
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', project.id)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('competitors')
      .select(['id', 'name', 'aliases', 'domains'])
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', project.id)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('brand_profiles')
      .select(['products_services', 'business_context'])
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', project.id)
      .executeTakeFirst(),
    admittedFactCheck(db, { workspaceId, projectId: project.id, auditScope }),
  ]);
  return { aliases, owned, unintended, competitors, profile, factCheck };
}
function frameInstruction(mode: string, project: { country_code: string; language_code: string }) {
  const localized = auditPolicy.constants.localized_instruction
    .replace('{country_code}', project.country_code || 'unspecified')
    .replace('{language_code}', project.language_code || 'unspecified');
  let framing = `${localized} ${auditPolicy.constants.forced_grounded_instruction}`;
  if (mode === 'consumer_like') framing = '';
  else if (mode === 'controlled_localized') framing = localized;
  return [framing, auditPolicy.constants.audit_answer_instruction].filter(Boolean).join(' ');
}
/** Panel identity: sorted keys, UTF-8, default JSON separators. */
function promptPanelHash(promptRows: Record<string, unknown>[]) {
  const panelJson = `[${promptRows
    .map(
      (row) =>
        `{${Object.entries(row)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
          .join(', ')}}`,
    )
    .join(', ')}]`;
  return createHash('sha256').update(panelJson).digest('hex');
}
function parseSeed(randomSeed: string | null | undefined) {
  const trimmed = randomSeed?.trim();
  if (trimmed && !/^[+-]?\d+$/u.test(trimmed)) throw invalid('random_seed must be an integer');
  try {
    return trimmed
      ? BigInt.asUintN(64, BigInt(trimmed)).toString()
      : randomBytes(8).readBigUInt64BE().toString();
  } catch {
    throw invalid('random_seed must be an integer');
  }
}
async function panelOf(
  db: Database,
  {
    workspaceId,
    projectId,
    input,
    settings,
  }: {
    workspaceId: string;
    projectId: string;
    input: AuditInput;
    settings: ReturnType<typeof auditSettings>;
  },
): Promise<{ prompts: FrozenPrompt[]; requested: Engine[]; repetitions: number }> {
  const prompts = await loadPrompts(db, workspaceId, projectId, input, settings);
  return {
    prompts,
    requested: [...new Set(input.engines)],
    repetitions: input.repetitions ?? settings.audit_repetitions,
  };
}

type PrepareOptions = {
  search?: ReturnType<typeof searchSettings>;
  at?: Date;
  selected?: Market | null;
};
export async function prepareAudit(
  db: Database,
  workspaceId: string,
  input: AuditInput,
  settings: ReturnType<typeof auditSettings>,
  providerSettings: ProviderSettings,
  trigger: string,
  { search = searchSettings(), at = new Date(), selected = null }: PrepareOptions = {},
) {
  trigger = trigger.trim().toLowerCase();
  if (!auditPolicy.constants.audit_triggers.includes(trigger))
    throw invalid(`Unsupported trigger: ${trigger}`);
  const stored = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', input.project_id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (!stored) throw notFound('Project');
  const market = selected ?? {
    id: null,
    country_code: stored.country_code,
    language_code: stored.language_code,
  };
  const project = {
    ...stored,
    country_code: market.country_code,
    language_code: market.language_code,
    ...searchContext(market.country_code, market.language_code),
  };
  const mode = input.benchmark_mode ?? project.benchmark_mode;
  if (!auditPolicy.benchmark_modes.includes(mode))
    throw invalid(`Unsupported benchmark mode: ${mode}`);
  const { prompts, requested, repetitions } = await panelOf(db, {
    workspaceId,
    projectId: project.id,
    input,
    settings,
  });
  if (requested.some((engine) => !auditPolicy.selectable_engines.includes(engine)))
    throw invalid('An engine is unavailable');
  const { engines, notApplicable } = marketEngines(requested, market, project);
  assertRepetitions(repetitions);
  if (prompts.length * repetitions * engines.length > settings.max_tasks_per_audit)
    throw invalid('Audit exceeds the task limit');
  const routes = await freezeRoutes({
    db,
    workspaceId,
    engines,
    prompts,
    project,
    settings,
    providerSettings,
    at,
  });
  const brand = await db
    .selectFrom('brands')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', project.id)
    .executeTakeFirst();
  const { aliases, owned, unintended, competitors, profile, factCheck } = await loadBrandContext(
    db,
    {
      workspaceId,
      project,
      brand,
      auditScope: input.audit_scope,
    },
  );
  const systemInstruction = frameInstruction(mode, project);
  const measurement = {
    retrieval_enabled: true,
    max_output_tokens: settings.audit_max_output_tokens,
    timeout_seconds: settings.audit_timeout_seconds,
    repetitions,
    answer_instruction: auditPolicy.constants.audit_answer_instruction,
    max_attempts: settings.max_attempts,
  };
  // The panel is what is asked and how it is counted. Tags (theme, intent,
  // buyer stage, persona) describe a prompt without changing either, so
  // correcting one never starts a new comparison series.
  const promptRows = prompts.map((prompt) => ({ text: prompt.text, cohort: prompt.cohort }));
  const panelHash = promptPanelHash(promptRows);
  const seed = parseSeed(input.random_seed);
  const brandName = brand?.name ?? project.brand_name;
  const configuration = frozenConfiguration({
    brand_name: brandName,
    brand_aliases: aliases.map((row) => row.alias),
    owned_domains: owned.map((row) => row.domain),
    unintended_domains: unintended.map((row) => row.domain),
    competitors,
    products_services: profile?.products_services ?? [],
    entity_matching: frozenEntityMatching(
      projectEntityMatching(profile?.business_context, strings(profile?.products_services), [
        { name: brandName, aliases: aliases.map((row) => row.alias) },
        ...competitors.map((row) => ({
          name: row.name,
          aliases: strings(row.aliases),
        })),
      ]),
    ),
    country_code: project.country_code,
    language_code: project.language_code,
    not_applicable_engines: notApplicable,
    audit_scope: input.audit_scope,
    trigger,
    benchmark_mode: mode,
    measurement_policy: measurement,
    system_instruction: systemInstruction,
    engines,
    repetitions,
    max_attempts: settings.max_attempts,
    max_run_seconds: settings.max_run_seconds,
    request_timeout_seconds: settings.audit_timeout_seconds,
    anthropic_max_uses: providerSettings.anthropicMaxUses,
    openai_max_tool_calls: providerSettings.openaiMaxToolCalls,
    slot_order_version: 'mt19937-v1',
    perception: admittedPerceptionVersions({
      auditScope: input.audit_scope,
      factCheck,
      model: gatewaySettings().model,
    }),
    fact_check: factCheck,
    panel_id: panelHash.slice(0, 16),
    panel_hash: panelHash,
    prompt_selection: promptSelection(input),
    prompt_hashes: promptRows.map((row) => createHash('sha256').update(row.text).digest('hex')),
    engine_routes: Object.fromEntries(
      routes.map((route) => [
        route.logical_engine,
        { ...route, ...auditPolicy.route_policies[route.logical_engine] },
      ]),
    ),
    ...(await freezeCatalogRevision(db, { workspaceId, projectId: project.id })),
    ...(input.audit_scope === 'commerce'
      ? {
          commerce_measurement: await freezeCommerceContext(
            db,
            { workspaceId, projectId: project.id },
            prompts.flatMap((prompt) => (prompt.id ? [prompt.id] : [])),
          ),
        }
      : {}),
  });
  return {
    project,
    prompts,
    routes,
    configuration,
    measurement,
    mode,
    repetitions,
    seed,
    systemInstruction,
    recoveryDeadlineHours: search.recoveryDeadlineHours,
    searchTimeoutSeconds: search.timeoutSeconds,
  };
}
export function auditSlots(
  prompts: number,
  engines: readonly Engine[],
  repetitions: number,
  seed: string,
) {
  return shuffleAuditSlots(
    Array.from({ length: prompts }, (_, prompt) =>
      engines.flatMap((engine) =>
        Array.from({ length: repetitions }, (_, repetition) => ({
          prompt,
          engine,
          repetition,
        })),
      ),
    ).flat(),
    seed,
  );
}
