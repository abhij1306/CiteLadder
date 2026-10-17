import { z } from 'zod';

import { policy } from '../config.ts';
import { createModelGateway, gatewaySettings, type ModelGateway } from '../models/gateway.ts';
import { competitorSuggestionPrompt } from '../config/discovery.ts';
import { getLogger } from '../logging.ts';
import { defaultTransport, ModelError } from '../models/http.ts';
import { competitorInput, cleanList } from './inputs.ts';
import { discoveryProfile, discoverySettings, type DiscoveryInput } from './discovery-inputs.ts';
import {
  collectFirstParty,
  collectIdentityResearch,
  createResearchClient,
  ResearchBudget,
  boundedEvidence,
  type ResearchEvidence,
  type ResearchTransport,
} from './research-evidence.ts';
import type { ResolvedSite } from './site-resolution.ts';
import { fetchWebsite, websiteIdentity, type WebsiteFetcher } from './safe-fetch.ts';
import type { Meter } from '../models/metering.ts';

const cfg = policy.discovery.constants;
const logger = getLogger('app.projects.research');

/** A failed research call degrades the review; the reason and duration make it diagnosable. */
function logModelFailure(phase: string, error: unknown, started: number) {
  logger.warning('brand_discovery.model_call_failed', {
    phase,
    reason: error instanceof ModelError ? error.code : 'unusable_answer',
    status: error instanceof ModelError ? error.status : undefined,
    elapsed_ms: Math.round(performance.now() - started),
  });
}

export const identityEnvelope = z.object({
  status: z.enum(['ready', 'insufficient_evidence', 'conflicting_evidence']),
  profile: discoveryProfile,
  signature: z
    .object({
      category: z.string().default(''),
      buyer: z.string().default(''),
      core_job: z.string().default(''),
      delivery_model: z.string().default(''),
      market_context: z.string().default(''),
    })
    .default({ category: '', buyer: '', core_job: '', delivery_model: '', market_context: '' }),
  field_evidence_refs: z.record(z.string(), z.array(z.string())).default({}),
});
type Identity = z.output<typeof identityEnvelope>;
export function validateIdentity(identity: Identity, items: readonly ResearchEvidence[]): Identity {
  const refs = new Set(items.map((item) => item.evidence_ref));
  for (const [field, values] of Object.entries(identity.field_evidence_refs)) {
    const supported = values.filter((value) => refs.has(value));
    if (values.length && !supported.length)
      throw new Error(`identity cited only unknown evidence for ${field}`);
    identity.field_evidence_refs[field] = supported;
  }
  return identity;
}
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
      const excluded = cfg.competitor_excluded_domains.some(
        (value) => normalized === value || normalized.endsWith(`.${value}`),
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
  env?: Record<string, string | undefined>;
  onCompetitors?: () => Promise<void>;
  checkCancelled?: () => void;
  signal?: AbortSignal;
};
async function generateIdentity(
  gateway: ModelGateway | null | undefined,
  input: DiscoveryInput,
  items: readonly ResearchEvidence[],
  modelCalls: Record<string, unknown>[],
  signal?: AbortSignal,
) {
  if (!gateway) return null;
  const started = performance.now();
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
        evidence: items,
      }),
      identityEnvelope,
      signal,
    );
    const identity = validateIdentity(generated.value, items);
    modelCalls.push({
      phase: 'identity',
      prompt_version: cfg.brand_identity_prompt_version,
      outcome: 'succeeded',
      ...generated.result,
      content: undefined,
    });
    return identity;
  } catch (error) {
    signal?.throwIfAborted();
    logModelFailure('identity', error, started);
    modelCalls.push({
      phase: 'identity',
      prompt_version: cfg.brand_identity_prompt_version,
      outcome: 'failed',
      provider: gateway.baseUrlHost,
      model: gateway.model,
    });
    return null;
  }
}
function captureMethod(kind: ResearchEvidence['source_kind']) {
  if (kind === 'first_party') return cfg.capture_method_crawler;
  return kind === 'external_fetch'
    ? cfg.capture_method_external_fetch
    : cfg.capture_method_external_search;
}
async function suggestCompetitors({
  gateway,
  identity,
  input,
  site,
  category,
  evidence,
  settings,
  modelCalls,
  signal,
}: {
  gateway: ModelGateway | null | undefined;
  identity: Identity | null;
  input: DiscoveryInput;
  site: ResolvedSite;
  category: string;
  evidence: readonly ResearchEvidence[];
  settings: ReturnType<typeof discoverySettings>;
  modelCalls: Record<string, unknown>[];
  signal?: AbortSignal;
}) {
  if (!gateway || !identity) return { competitors: [], available: false };
  const schema = z.object({
    competitors: z.array(competitorInput).max(settings.competitor_suggestion_maximum),
  });
  for (let attempt = 0; attempt < settings.competitor_model_maximum_attempts; attempt++) {
    const started = performance.now();
    try {
      const generated = await gateway.structured(
        competitorSuggestionPrompt(settings.competitor_suggestion_maximum),
        JSON.stringify({
          brand_name: input.brand_name,
          owned_domain: site.domain,
          primary_market: input.primary_market,
          profile: identity.profile,
          signature: { ...identity.signature, category },
          evidence: boundedEvidence(evidence, settings.competitor_suggestion_evidence_max_chars),
        }),
        schema,
        signal,
      );
      const competitors = cleanSuggestions(
        generated.value.competitors,
        input.brand_name,
        site.domain,
        settings.competitor_suggestion_maximum,
      );
      modelCalls.push({
        phase: 'competitor_suggestions',
        prompt_version: cfg.brand_competitor_suggestion_version,
        outcome: 'succeeded',
        ...generated.result,
        content: undefined,
      });
      return { competitors, available: true };
    } catch (error) {
      signal?.throwIfAborted();
      logModelFailure('competitor_suggestions', error, started);
      modelCalls.push({
        phase: 'competitor_suggestions',
        prompt_version: cfg.brand_competitor_suggestion_version,
        outcome: 'failed',
        provider: gateway.baseUrlHost,
        model: gateway.model,
      });
    }
  }
  return { competitors: [], available: false };
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
export async function researchBrand(
  input: DiscoveryInput,
  site: ResolvedSite,
  dependencies: ResearchDependencies,
) {
  dependencies.checkCancelled?.();
  const settings = discoverySettings(dependencies.env);
  const budget = new ResearchBudget(settings.keenable_total_call_cap);
  const client = createResearchClient(settings, budget, dependencies.transport ?? fetch, {
    meter: dependencies.meter,
    feature: 'research_evidence',
  });
  const [firstParty, external] = await Promise.all([
    collectFirstParty(site, dependencies.fetcher ?? fetchWebsite),
    settings.keenable_api_key
      ? collectIdentityResearch(client, settings, input.brand_name, site.domain)
      : Promise.resolve({ state: 'unavailable', items: [] as ResearchEvidence[] }),
  ]);
  const items = [
    ...boundedEvidence(firstParty.items, settings.identity_first_party_evidence_max_chars),
    ...external.items,
  ];
  let gateway = dependencies.gateway;
  if (gateway === undefined) {
    try {
      gateway = createModelGateway(
        {
          ...gatewaySettings(dependencies.env),
          timeoutSeconds: settings.research_model_timeout_seconds,
          attempts: 1,
        },
        defaultTransport,
      );
    } catch {
      gateway = null;
    }
  }
  if (gateway) gateway = dependencies.meter.gateway(gateway, 'project_research');
  const modelCalls: Record<string, unknown>[] = [];
  dependencies.checkCancelled?.();
  const identity = await generateIdentity(gateway, input, items, modelCalls, dependencies.signal);
  const profile =
    identity?.profile ??
    discoveryProfile.parse({
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
  await dependencies.onCompetitors?.();
  const category = identity
    ? identity.signature.category ||
      profile.category ||
      profile.category_terms[0] ||
      profile.products_services[0] ||
      ''
    : '';
  let competitorEvidence: ResearchEvidence[] = [];
  let competitorState = 'unavailable';
  if (gateway && category && settings.keenable_api_key) {
    try {
      competitorEvidence = await client.search(
        `${input.brand_name} ${category} alternatives competitors ${input.primary_market}`,
        null,
        settings.competitor_search_max_results,
        'competitor-search',
      );
      competitorState = competitorEvidence.length ? 'ready' : 'no_results';
    } catch {
      competitorState = 'failed';
    }
  }
  dependencies.checkCancelled?.();
  const { competitors, available } = await suggestCompetitors({
    gateway,
    identity,
    input,
    site,
    category,
    evidence: competitorEvidence,
    settings,
    modelCalls,
    signal: dependencies.signal,
  });
  const warnings = researchWarnings(
    site.warning,
    external.state,
    competitorState,
    identity,
    available,
    competitors.length,
  );
  const manifest = [...items, ...competitorEvidence];
  const capturedAt = new Date().toISOString();
  const evidence = manifest.map((item) => ({
    source_url: item.source_url,
    capture_method: captureMethod(item.source_kind),
    confidence: item.source_kind === 'first_party' ? 0.9 : 0.7,
    captured_at: capturedAt,
    supports: item.supports,
    provider: item.provider,
    model: '',
    method: item.evidence_ref,
  }));
  const successful = modelCalls.find((call) => call.outcome === 'succeeded');
  return {
    profile,
    competitors,
    warnings,
    evidence,
    pagesRead: firstParty.pages.length,
    snapshot: {
      review_state: 'unreviewed',
      profile,
      competitive_signature: identity?.signature ?? {},
      competitors,
      offerings: firstParty.offerings,
      evidence_manifest: manifest,
      model_calls: modelCalls,
      field_evidence_refs: identity?.field_evidence_refs ?? {},
      metrics: {
        keenable_calls_used: budget.used,
        first_party_capture_version: policy.brand_evidence.version,
        external_research_version: cfg.keenable_research_version,
        external_state: external.state,
        competitor_search_state: competitorState,
      },
    },
    provider: z.string().catch('').parse(successful?.endpoint_host),
    model: z.string().catch('').parse(successful?.returned_model),
  };
}
