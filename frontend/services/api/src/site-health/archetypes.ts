/** Onboarding may assign a site archetype; crawl structure may only veto it. */
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import type { ArchitecturePage } from './architecture-model.ts';

const p = policy.site_health.archetypes;
type Structure = { key: string; label: string };
function structures(archetype: string, pages: ArchitecturePage[], market: string) {
  const common: (Structure & {
    local_market_only: boolean;
    page_kinds: string[];
    path_segments: string[];
  })[] =
    policy.site_health.common_structures[
      archetype as keyof typeof policy.site_health.common_structures
    ] ?? [];
  const observed: Structure[] = [];
  const absent: Structure[] = [];
  for (const structure of common) {
    if (structure.local_market_only && !['local', 'regional'].includes(market)) continue;
    const seen = pages.some(
      (page) =>
        structure.page_kinds.includes(page.kind) ||
        new URL(page.url).pathname
          .split('/')
          .some((segment) => structure.path_segments.includes(segment.toLowerCase())),
    );
    (seen ? observed : absent).push({ key: structure.key, label: structure.label });
  }
  return { observed, absent };
}
function contradicted(archetype: string, pages: ArchitecturePage[]) {
  if (pages.length < p.contradiction_min_pages) return false;
  const corroborating =
    p.corroborating_page_kinds[archetype as keyof typeof p.corroborating_page_kinds] ?? [];
  const contradicting =
    p.contradicting_page_kinds[archetype as keyof typeof p.contradicting_page_kinds] ?? [];
  return (
    !pages.some((page) => corroborating.includes(page.kind)) &&
    pages.filter((page) => contradicting.includes(page.kind)).length / pages.length >=
      p.contradiction_share
  );
}
export function assessArchetype(pages: ArchitecturePage[], coverage: string, raw: unknown) {
  const context = record(raw);
  const model = typeof context.business_model === 'string' ? context.business_model : '';
  const confidence = record(context.field_confidence).business_model;
  const evidence = {
    knowledge_strength:
      typeof context.knowledge_strength === 'string' ? context.knowledge_strength : 'none',
    business_model_confidence:
      typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0,
    market_scope: typeof context.market_scope === 'string' ? context.market_scope : '',
  };
  const archetype = p.by_business_model[model as keyof typeof p.by_business_model] ?? p.other;
  const abstain = (reason: string) => ({
    archetype: p.other,
    source: p.source_abstained,
    reason,
    business_model: model,
    profile_evidence: evidence,
    observed: [] as Structure[],
    not_observed: [] as Structure[],
  });
  if (!Object.keys(context).length) return { ...abstain('profile_absent'), profile_evidence: {} };
  if (evidence.knowledge_strength === 'none') return abstain('knowledge_strength_none');
  if (evidence.business_model_confidence < p.business_model_confidence_floor)
    return abstain('business_model_confidence_below_floor');
  if (archetype === p.other) return abstain('business_model_not_mapped');
  if (contradicted(archetype, pages)) return abstain('crawl_materially_contradicts_profile');
  const common = structures(archetype, pages, evidence.market_scope);
  return {
    archetype,
    source: p.source_onboarding,
    reason: 'profile_supported',
    business_model: model,
    profile_evidence: evidence,
    observed: common.observed,
    not_observed: coverage === 'complete' ? common.absent : [],
  };
}
