import { z } from 'zod';

import { domainMatches } from '../analysis/domains.ts';
import { policy } from '../config.ts';
import { createModelGateway, gatewaySettings, type ModelGateway } from '../models/gateway.ts';
import { competitorSuggestionPrompt } from '../config/discovery.ts';
import type { SettingSource } from '../config/settings.ts';
import { getLogger } from '../logging.ts';
import { defaultTransport, ModelError } from '../models/http.ts';
import { ApiError } from '../errors.ts';
import { competitorInput, cleanList } from './inputs.ts';
import { discoveryProfile, discoverySettings, type DiscoveryInput } from './discovery-inputs.ts';
import {
  boundedPages,
  collectFirstParty,
  collectIdentityResearch,
  createResearchClient,
  ResearchBudget,
  type ResearchClient,
  type ResearchPage,
  type ResearchTransport,
} from './research-evidence.ts';
import { researchThemes, themeCandidates } from './research-themes.ts';
import type { ResolvedSite } from './site-resolution.ts';
import { fetchWebsite, websiteIdentity, type WebsiteFetcher } from '../safe-fetch.ts';
import type { Meter } from '../models/metering.ts';

const cfg = policy.discovery.constants;
const logger = getLogger('app.projects.research');

export function failureFields(error: unknown) {
  if (error instanceof ModelError)
    return { error_class: 'ModelError', reason: error.code, status: error.status };
  if (error instanceof ApiError)
    return { error_class: 'ApiError', reason: error.code, status: error.status };
  return { error_class: error instanceof Error ? error.name : typeof error };
}

function logModelFailure(phase: string, error: unknown, started: number) {
  logger.warning('brand_discovery.model_call_failed', {
    phase,
    reason: 'unusable_answer',
    ...failureFields(error),
    elapsed_ms: Math.round(performance.now() - started),
  });
}

export class ResearchFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(`Brand research failed: ${code}`);
    this.name = 'ResearchFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

function phaseDeadline(milliseconds: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Research phase deadline passed', 'TimeoutError')),
    Math.max(0, milliseconds),
  );
  return {
    signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    clear: () => clearTimeout(timer),
  };
}

const identityEnvelope = z.object({
  status: z.enum(['ready', 'insufficient_evidence', 'conflicting_evidence']),
  profile: discoveryProfile,
});
type Identity = z.output<typeof identityEnvelope>;
const themesEnvelope = z.object({ themes: themeCandidates });
type ModelCall = {
  phase: string;
  prompt_version: string;
  outcome: 'succeeded' | 'failed';
} & Record<string, unknown>;

export function cleanSuggestions(
  items: z.output<typeof competitorInput>[],
  brand: string,
  domain: string,
  maximum: number,
) {
  const seenNames = new Set([brand.toLowerCase()]);
  const seenDomains = new Set([domain]);
  return items
    .flatMap((item) => {
      let normalized;
      try {
        normalized = websiteIdentity(item.domains[0] ?? '').domain;
      } catch {
        return [];
      }
      const excluded = cfg.competitor_excluded_domains.some((value) =>
        domainMatches(normalized, value),
      );
      if (excluded || seenNames.has(item.name.toLowerCase()) || seenDomains.has(normalized))
        return [];
      seenNames.add(item.name.toLowerCase());
      seenDomains.add(normalized);
      return [{ name: item.name, aliases: cleanList(item.aliases), domains: [normalized] }];
    })
    .slice(0, maximum);
}
export type ResearchDependencies = {
  /** Every model and Keenable call is metered for the workspace. */
  meter: Meter;
  fetcher?: WebsiteFetcher;
  transport?: ResearchTransport;
  gateway?: ModelGateway | null;
  env?: SettingSource;
  onCompetitors?: () => Promise<void>;
  checkCancelled?: () => void;
  signal?: AbortSignal;
  budgetEndsAt?: number;
};
type Settings = ReturnType<typeof discoverySettings>;
type Call = {
  gateway: ModelGateway;
  modelCalls: ModelCall[];
  timeoutMs: number;
  signal: AbortSignal;
};
type Request = { input: DiscoveryInput; pages: readonly ResearchPage[]; call: Call };
const succeeded = (
  phase: string,
  version: string,
  result: Awaited<ReturnType<ModelGateway['structured']>>['result'],
): ModelCall => ({
  phase,
  prompt_version: version,
  outcome: 'succeeded',
  ...result,
  content: undefined,
});
const failed = (phase: string, version: string, gateway: ModelGateway): ModelCall => ({
  phase,
  prompt_version: version,
  outcome: 'failed',
  provider: gateway.baseUrlHost,
  model: gateway.model,
});

async function generateIdentity({
  input,
  pages,
  call: { gateway, modelCalls, timeoutMs, signal },
}: Request) {
  const started = performance.now();
  const deadline = phaseDeadline(timeoutMs, signal);
  try {
    const generated = await gateway.structured(
      cfg.identity_research_system_prompt,
      JSON.stringify({
        ...input,
        prompt_version: cfg.brand_identity_prompt_version,
        allowed_business_models: cfg.business_models,
        allowed_market_scopes: cfg.market_scopes,
        allowed_buyer_registers: cfg.buyer_registers,
        allowed_sectors: cfg.sectors,
        allowed_knowledge_strengths: cfg.knowledge_strengths,
        pages,
      }),
      identityEnvelope,
      deadline.signal,
    );
    modelCalls.push(succeeded('identity', cfg.brand_identity_prompt_version, generated.result));
    return generated.value;
  } catch (error) {
    signal.throwIfAborted();
    logModelFailure('identity', error, started);
    // A gateway refusal answers the same on every attempt; a model failure may not.
    throw new ResearchFailure(cfg.error_brand_identity_unavailable, !(error instanceof ApiError));
  } finally {
    deadline.clear();
  }
}

async function generateThemes({
  input,
  pages,
  call: { gateway, modelCalls, timeoutMs, signal },
}: Request) {
  const started = performance.now();
  const deadline = phaseDeadline(timeoutMs, signal);
  try {
    const generated = await gateway.structured(
      cfg.theme_research_system_prompt,
      JSON.stringify({
        brand_name: input.brand_name,
        primary_market: input.primary_market,
        prompt_version: cfg.brand_theme_prompt_version,
        pages,
      }),
      themesEnvelope,
      deadline.signal,
    );
    modelCalls.push(succeeded('themes', cfg.brand_theme_prompt_version, generated.result));
    return generated.value.themes;
  } catch (error) {
    signal.throwIfAborted();
    logModelFailure('themes', error, started);
    modelCalls.push(failed('themes', cfg.brand_theme_prompt_version, gateway));
    return [];
  } finally {
    deadline.clear();
  }
}

export function competitorQueries(input: DiscoveryInput, site: ResolvedSite) {
  const brand = new RegExp(
    input.brand_name.replaceAll(/[.*+?^${}()|[\]\\]/gu, (character) => `\\${character}`),
    'giu',
  );
  const trade = (site.page?.title ?? '')
    .split(/\s+[|–—-]\s+|\s*\|\s*|:\s+/u)
    .map((part) => {
      const kept = part.replace(brand, ' ').replaceAll(/\s+/gu, ' ').trim();
      return kept === part.trim() || kept.split(' ').length > 1 ? kept : '';
    })
    .filter(Boolean)
    .join(' ')
    .slice(0, cfg.competitor_trade_query_max_chars);
  const named = `${input.brand_name} alternatives competitors ${input.primary_market}`;
  return trade ? [named, trade] : [named];
}

async function findCompetitors({
  client,
  input,
  site,
  pages,
  settings,
  call,
}: {
  client: ResearchClient | null;
  input: DiscoveryInput;
  site: ResolvedSite;
  pages: readonly ResearchPage[];
  settings: Settings;
  call: Call;
}) {
  let searchResults: ResearchPage[] = [];
  let searchState = 'unavailable';
  if (client) {
    const outcomes = await Promise.allSettled(
      competitorQueries(input, site).map((query) =>
        client.search(query, null, settings.competitor_search_max_results),
      ),
    );
    call.signal.throwIfAborted();
    searchResults = outcomes.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? outcome.value : [],
    );
    const failed = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    );
    if (failed.length)
      logger.warning('brand_discovery.competitor_search_failed', failureFields(failed[0]));
    if (failed.length === outcomes.length) searchState = 'failed';
    else if (failed.length) searchState = 'partial';
    else searchState = searchResults.length ? 'ready' : 'no_results';
  }
  const schema = z.object({
    competitors: z.array(competitorInput).max(settings.competitor_suggestion_maximum),
  });
  const deadline = phaseDeadline(call.timeoutMs, call.signal);
  try {
    for (
      let attempt = 0;
      attempt < settings.competitor_model_maximum_attempts && !deadline.signal.aborted;
      attempt++
    ) {
      const started = performance.now();
      try {
        const generated = await call.gateway.structured(
          competitorSuggestionPrompt(settings.competitor_suggestion_maximum),
          JSON.stringify({
            brand_name: input.brand_name,
            owned_domain: site.domain,
            primary_market: input.primary_market,
            pages: boundedPages(pages, settings.competitor_suggestion_evidence_max_chars),
            search_results: boundedPages(
              searchResults,
              settings.competitor_suggestion_evidence_max_chars,
            ),
          }),
          schema,
          deadline.signal,
        );
        call.modelCalls.push(
          succeeded(
            'competitor_suggestions',
            cfg.brand_competitor_suggestion_version,
            generated.result,
          ),
        );
        const competitors = cleanSuggestions(
          generated.value.competitors,
          input.brand_name,
          site.domain,
          settings.competitor_suggestion_maximum,
        );
        return { competitors, available: true, searchState };
      } catch (error) {
        call.signal.throwIfAborted();
        logModelFailure('competitor_suggestions', error, started);
        call.modelCalls.push(
          failed('competitor_suggestions', cfg.brand_competitor_suggestion_version, call.gateway),
        );
      }
    }
  } finally {
    deadline.clear();
  }
  return { competitors: [], available: false, searchState };
}
function researchWarnings(
  warning: string,
  externalState: string,
  competitorState: string,
  identity: Identity | null,
  available: boolean,
  count: number,
) {
  const warnings = new Set<string>(warning ? [warning] : []);
  if (['unavailable', 'failed'].includes(externalState))
    warnings.add('external_research_unavailable');
  if (externalState === 'no_results') warnings.add('external_research_no_results');
  if (competitorState === 'failed') warnings.add('competitor_search_failed');
  if (!identity || !available) warnings.add('research_degraded');
  if (!count) warnings.add('competitors_not_found');
  if (identity?.status === 'insufficient_evidence') warnings.add('insufficient_evidence');
  const confidence = cfg.identity_conflict_fields.flatMap((field) => {
    const value = identity?.profile.field_confidence[field];
    return value === undefined ? [] : [value];
  });
  if (
    identity?.status === 'conflicting_evidence' &&
    (!confidence.length || Math.min(...confidence) < cfg.identity_conflict_confidence_ceiling)
  )
    warnings.add('conflicting_evidence');
  return [...warnings];
}
function researchGateways(dependencies: ResearchDependencies, settings: Settings) {
  const metered = (gateway: ModelGateway | null) =>
    gateway && dependencies.meter.gateway(gateway, 'project_research');
  if (dependencies.gateway !== undefined)
    return { identity: metered(dependencies.gateway), other: metered(dependencies.gateway) };
  try {
    const base = {
      ...gatewaySettings(dependencies.env),
      timeoutSeconds: settings.interactive_timeout_seconds,
      attempts: 1,
    };
    return {
      identity: metered(
        createModelGateway(
          {
            ...base,
            maxOutputTokens: Math.min(base.maxOutputTokens, settings.identity_max_output_tokens),
          },
          defaultTransport,
        ),
      ),
      other: metered(createModelGateway(base, defaultTransport)),
    };
  } catch (error) {
    logger.warning('brand_discovery.model_unavailable', failureFields(error));
    return { identity: null, other: null };
  }
}
function fallbackProfile(input: DiscoveryInput) {
  return discoveryProfile.parse({
    industry: input.industry,
    category: input.subindustry,
    description: '',
    positioning: '',
    products_services: [],
    target_audience: '',
    business_type: null,
    price_tier: 'unknown',
    field_confidence: {},
  });
}
export async function researchBrand(
  input: DiscoveryInput,
  site: ResolvedSite,
  dependencies: ResearchDependencies,
) {
  dependencies.checkCancelled?.();
  const settings = discoverySettings(dependencies.env);
  const budgetEndsAt =
    dependencies.budgetEndsAt ?? performance.now() + settings.interactive_timeout_seconds * 1000;
  const remaining = () => Math.max(0, budgetEndsAt - performance.now());
  const budget = new ResearchBudget(settings.keenable_total_call_cap);
  const client = settings.keenable_api_key
    ? createResearchClient(settings, budget, dependencies.transport ?? fetch, {
        meter: dependencies.meter,
        feature: 'research_evidence',
      })
    : null;
  const gateways = researchGateways(dependencies, settings);
  const sibling = new AbortController();
  const signal = dependencies.signal
    ? AbortSignal.any([sibling.signal, dependencies.signal])
    : sibling.signal;
  const modelCalls: ModelCall[] = [];
  const firstPartyRead = collectFirstParty(site, dependencies.fetcher ?? fetchWebsite);
  const competitorsFound = firstPartyRead.then((firstParty) =>
    gateways.other
      ? findCompetitors({
          client,
          input,
          site,
          pages: firstParty.items,
          settings,
          call: { gateway: gateways.other, modelCalls, timeoutMs: remaining(), signal },
        })
      : { competitors: [], available: false, searchState: 'unavailable' },
  );
  competitorsFound.catch(() => undefined);
  const [firstParty, external] = await Promise.all([
    firstPartyRead,
    client
      ? collectIdentityResearch(client, settings, input.brand_name, site.domain)
      : { state: 'unavailable', items: [] },
  ]);
  dependencies.checkCancelled?.();
  const pages = [
    ...boundedPages(firstParty.items, settings.identity_first_party_evidence_max_chars),
    ...external.items,
  ];
  const identityFound = gateways.identity
    ? generateIdentity({
        input,
        pages,
        call: {
          gateway: gateways.identity,
          modelCalls,
          timeoutMs: Math.min(settings.identity_model_timeout_seconds * 1000, remaining()),
          signal,
        },
      })
        .then(async (identity) => {
          await dependencies.onCompetitors?.();
          return identity;
        })
        .catch((error: unknown) => {
          sibling.abort(error);
          throw error;
        })
    : Promise.resolve(null);
  const themesFound = gateways.other
    ? generateThemes({
        input,
        pages,
        call: { gateway: gateways.other, modelCalls, timeoutMs: remaining(), signal },
      })
    : Promise.resolve([]);
  const [identityOutcome, themesOutcome, competitorsOutcome] = await Promise.allSettled([
    identityFound,
    themesFound,
    competitorsFound,
  ]);
  dependencies.signal?.throwIfAborted();
  if (identityOutcome.status === 'rejected') throw identityOutcome.reason;
  if (themesOutcome.status === 'rejected') throw themesOutcome.reason;
  if (competitorsOutcome.status === 'rejected') throw competitorsOutcome.reason;
  const identity = identityOutcome.value;
  const { competitors, available, searchState } = competitorsOutcome.value;
  const profile = identity?.profile ?? fallbackProfile(input);
  const warnings = researchWarnings(
    site.warning,
    external.state,
    searchState,
    identity,
    available,
    competitors.length,
  );
  const successful = modelCalls.find((call) => call.phase === 'identity');
  return {
    profile,
    competitors,
    warnings,
    pagesRead: firstParty.pages.length,
    snapshot: {
      review_state: 'unreviewed',
      identity_status: identity?.status ?? null,
      profile,
      competitors,
      offerings: firstParty.offerings,
      model_calls: modelCalls,
      themes: researchThemes(
        identity ? { themes: themesOutcome.value } : null,
        policy.perception.project_themes,
      ),
      metrics: {
        keenable_calls_used: budget.used,
        external_state: external.state,
        competitor_search_state: searchState,
      },
    },
    provider: z.string().catch('').parse(successful?.endpoint_host),
    model: z.string().catch('').parse(successful?.returned_model),
  };
}
