/**
 * Provider Settings view-model helpers (direct-provider retirement).
 *
 * Turns the raw `/provider-catalog` payload + the workspace's
 * `/provider-connections` into the per-engine card model the UI renders. The
 * catalog is the single source of truth for which (logical engine → transport →
 * model) routes are available. After the direct-provider retirement each
 * logical engine has exactly ONE direct transport — ChatGPT/OpenAI,
 * Gemini/Google, Claude/Anthropic — so each card renders a single fixed direct
 * route with no toggle and no reserved "coming soon" option.
 *
 * Settings manages CREDENTIALS, not engines: one DataForSEO login serves every
 * consumer-app and search surface, so `buildProviderGroups` folds the engine
 * cards into one group per transport and a save routes all of them at once.
 */
import type {
  LogicalEngine,
  SurfaceKind,
  ProviderCatalog,
  ProviderConnection,
  ProviderConnectionState,
  ProviderConnectionStateEntry,
  TransportProvider,
} from '@/lib/api/types';

/** Logical engines rendered as cards, in display order. */
export const ENGINE_ORDER: readonly LogicalEngine[] = [
  'chatgpt_search',
  'gemini_consumer',
  'chatgpt',
  'gemini',
  'claude',
  'google_ai_overview',
] as const;

/** Human display names for each logical engine. */
export const ENGINE_LABELS: Record<LogicalEngine, string> = {
  chatgpt: 'ChatGPT API',
  gemini: 'Gemini API',
  claude: 'Claude API',
  chatgpt_search: 'ChatGPT Search',
  gemini_consumer: 'Gemini',
  google_ai_overview: 'Google AI Overview',
};

/**
 * The engines that are OBSERVED on a results page rather than asked a question.
 *
 * Kept as its own list because the difference is real everywhere it shows up:
 * nothing is sent to an observed surface, it has no model and no retrieval
 * state, and a filter that calls the whole set "models" misdescribes it. The
 * backend carries the same distinction as `surface_kind` on the route.
 */
const SEARCH_SURFACE_ENGINES: readonly LogicalEngine[] = ['google_ai_overview'] as const;

/** True when this engine key names an observed surface. */
export function isSearchSurfaceEngine(key: string): boolean {
  const surfaces: readonly string[] = SEARCH_SURFACE_ENGINES;
  return surfaces.includes(key);
}

export function isConsumerEngine(key: string): boolean {
  return key === 'chatgpt_search' || key === 'gemini_consumer' || isSearchSurfaceEngine(key);
}

/** Human display names for each transport provider. */
export const TRANSPORT_LABELS: Record<TransportProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  // Named only in helper text on the credential card. The product label for
  // this surface is "Google AI Overview"; the provider is how we reach it.
  dataforseo: 'DataForSEO',
};

/** Domains for a transport's brand logo on its credential row. */
export const TRANSPORT_DOMAINS: Record<TransportProvider, string> = {
  openai: 'openai.com',
  anthropic: 'anthropic.com',
  google: 'google.com',
  dataforseo: 'dataforseo.com',
};

/** Local brand logo assets for engines when available. */
export const ENGINE_LOGOS: Record<string, string> = {
  claude: '/brand/claude.webp',
  copilot: '/brand/copilot.webp',
  grok: '/brand/grok.webp',
  perplexity: '/brand/perplexity.webp',
};

/** Human label for an engine key (falls back to the raw key). */
export function engineLabel(key: string): string {
  return ENGINE_LABELS[key as LogicalEngine] ?? key;
}

/** Human label for a transport key (falls back to the raw key). */
export function transportLabel(key: string): string {
  return TRANSPORT_LABELS[key as TransportProvider] ?? key;
}

/**
 * The transport as the PRODUCT names it, or null where naming it says nothing
 * a reader can act on.
 *
 * A measured LLM answer is genuinely "ChatGPT via OpenAI" — the reader chose
 * that route and can change it. An observed search surface is not: "Google AI
 * Overview" IS the product, and the vendor we reach the results page through is
 * a procurement detail. It belongs on the credential card in Settings, where
 * someone is entering those credentials, and nowhere in AI visibility.
 */
export function productTransportLabel(key: string): string | null {
  return key === 'dataforseo' ? null : transportLabel(key);
}

/**
 * The same rule for a transport MODEL id. An LLM route's model is real
 * provenance a reader compares runs by; an observed surface's is the vendor's
 * endpoint name, which describes our plumbing rather than what was measured.
 */
export function productModelLabel(engine: string, model: string | null | undefined): string | null {
  if (!model) return null;
  return isConsumerEngine(engine) ? null : model;
}

/** The single fixed route on an engine card. */
type EngineRouteOption = {
  transport_provider: TransportProvider;
  model: string;
  /** Toggle-free label, e.g. "Direct (OpenAI)". */
  label: string;
  /** `llm` routes are asked a question; `search_ai` routes are observed. */
  surface_kind: SurfaceKind;
  /**
   * Which auth shape this route's credential takes. Kept on the route rather
   * than derived at each input, so exactly one place decides it.
   */
  credential_shape: CredentialShape;
};

/** The two credential shapes a transport can authenticate with. */
type CredentialShape = 'key' | 'basic';

/**
 * The auth shape for a transport. Bearer key unless stated otherwise.
 *
 * Module-private: the shape reaches the UI on the route it belongs to, so
 * nothing outside this file needs to ask the question again and get a
 * different answer.
 */
function credentialShapeFor(transport: TransportProvider): CredentialShape {
  return transport === 'dataforseo' ? 'basic' : 'key';
}

/** The full view-model for one engine card. */
export type EngineCardModel = {
  logical_engine: LogicalEngine;
  label: string;
  /** The single direct route for this engine (null if the catalog omits it). */
  route: EngineRouteOption | null;
  /**
   * Whether this engine can be connected at all. An engine the catalog
   * publishes no route for is `unavailable` with `route: null`, which is what
   * makes it non-connectable: it constructs no mutation.
   */
  availability: 'available' | 'unavailable';
  /**
   * The AUTHENTICATED workspace state, distinct from availability. A provider
   * can be generally available and still `missing` for this workspace.
   */
  state: ProviderConnectionState;
  /** Safe probe/state reason from the authenticated projection. */
  safe_reason: string | null;
  latest_probe: ProviderConnectionStateEntry['latest_probe'];
};

/**
 * Display label for a route.
 *
 * An observed surface is not reached "directly" in the sense the LLM cards
 * mean — nothing is sent to Google. Saying so would misdescribe what the
 * measurement is.
 */
function routeLabel(transport: TransportProvider, surfaceKind: SurfaceKind): string {
  if (surfaceKind === 'search_ai') return `Observed via ${TRANSPORT_LABELS[transport]}`;
  if (surfaceKind === 'llm_scraper') return `Consumer app via ${TRANSPORT_LABELS[transport]}`;
  return `Direct (${TRANSPORT_LABELS[transport]})`;
}

/**
 * Build the ordered engine card models.
 *
 * One model per shipped engine, each with its single catalog route. Planned
 * providers are not listed: nothing can be connected for them.
 *
 * The authenticated `states` projection decides the four-state badge. It FAILS
 * CLOSED: without it, a configured key shows as `missing` rather than
 * `connected`, because "we stored a key" is not evidence that the key works —
 * only a successful probe is.
 */
export function buildEngineCards(
  catalog: ProviderCatalog | undefined,
  states?: readonly ProviderConnectionStateEntry[],
): EngineCardModel[] {
  const byEngine = new Map(catalog?.engines.map((e) => [e.logical_engine, e]) ?? []);
  const byKey = new Map((states ?? []).map((entry) => [entry.key, entry]));

  return ENGINE_ORDER.map((engine) => {
    const approved = byEngine.get(engine)?.routes ?? [];
    const approvedRoute = approved[0];
    const route: EngineRouteOption | null = approvedRoute
      ? {
          transport_provider: approvedRoute.transport_provider,
          model: approvedRoute.transport_model,
          label: routeLabel(approvedRoute.transport_provider, approvedRoute.surface_kind),
          surface_kind: approvedRoute.surface_kind,
          credential_shape: credentialShapeFor(approvedRoute.transport_provider),
        }
      : null;
    const entry = byKey.get(engine) ?? byKey.get(`provider.${engine}`);
    return {
      logical_engine: engine,
      label: ENGINE_LABELS[engine],
      route,
      availability: route ? ('available' as const) : ('unavailable' as const),
      state: entry?.state ?? ('missing' as const),
      safe_reason: entry?.safe_reason ?? null,
      latest_probe: entry?.latest_probe ?? null,
    };
  });
}

/** True when this card may construct a save/test mutation at all. */
function isConnectable(model: EngineCardModel): boolean {
  return model.availability === 'available' && model.route !== null;
}

/** One stored credential and every engine it measures. */
export type ProviderGroup = {
  transport: TransportProvider;
  label: string;
  credential_shape: CredentialShape;
  /** Connectable engines routed through this credential, in display order. */
  engines: EngineCardModel[];
};

/**
 * Fold the engine cards into one group per transport, ordered by each
 * transport's first engine. Only connectable engines join a group, so a
 * transport with no published route is simply absent.
 */
export function buildProviderGroups(cards: readonly EngineCardModel[]): ProviderGroup[] {
  const groups = new Map<TransportProvider, ProviderGroup>();
  for (const card of cards) {
    if (!isConnectable(card) || !card.route) continue;
    const transport = card.route.transport_provider;
    const group = groups.get(transport) ?? {
      transport,
      label: TRANSPORT_LABELS[transport],
      credential_shape: card.route.credential_shape,
      engines: [],
    };
    group.engines.push(card);
    groups.set(transport, group);
  }
  return [...groups.values()];
}

/** The transport whose credential measures `engine`, if one is published. */
export function transportForEngine(
  groups: readonly ProviderGroup[],
  engine: LogicalEngine,
): TransportProvider | null {
  return (
    groups.find((group) => group.engines.some((card) => card.logical_engine === engine))
      ?.transport ?? null
  );
}

/**
 * Find the connection that serves a given transport in this workspace. BYOK
 * connections are keyed by `transport_provider`.
 */
export function connectionForTransport(
  connections: ProviderConnection[],
  transport: TransportProvider,
): ProviderConnection | undefined {
  return connections.find((c) => c.transport_provider === transport);
}

/** True when a connection exists for the transport AND has a stored key. */
export function isConfigured(connection: ProviderConnection | undefined): boolean {
  return Boolean(connection?.api_key_set);
}

/**
 * True when a connection is actually EXECUTABLE — a stored key whose latest
 * probe succeeded. This is the frontend mirror of the backend's admission
 * filter (`resolve_execution_credentials`), which skips any BYOK route whose
 * `last_test_status` is not `ok`. "We stored a key" is a weaker fact than
 * "the key works", and only the stronger one may offer an engine for a launch.
 */
export function isVerified(connection: ProviderConnection | undefined): boolean {
  return isConfigured(connection) && connection?.last_test_status === 'ok';
}

/**
 * Merge logical-engine routes into a connection's existing routes for a
 * create/update payload. Preserves routes already on the connection (and their
 * default flag) and adds each missing engine once.
 */
export function mergeRoutePayload(
  existing: ProviderConnection | undefined,
  engines: readonly LogicalEngine[],
): { logical_engine: LogicalEngine; is_default: boolean }[] {
  const routes = (existing?.routes ?? []).map((r) => ({
    logical_engine: r.logical_engine,
    is_default: r.is_default,
  }));
  for (const logical_engine of engines) {
    if (!routes.some((r) => r.logical_engine === logical_engine)) {
      routes.push({ logical_engine, is_default: false });
    }
  }
  return routes;
}
