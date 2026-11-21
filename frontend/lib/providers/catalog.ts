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
} from '@citeladder/contracts';

const TRANSPORT_LABELS: Record<TransportProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  dataforseo: 'DataForSEO',
};

export const TRANSPORT_DOMAINS: Record<TransportProvider, string> = {
  openai: 'openai.com',
  anthropic: 'anthropic.com',
  google: 'google.com',
  dataforseo: 'dataforseo.com',
};

export const ENGINE_LOGOS: Record<string, string> = {
  claude: '/brand/claude.webp',
  copilot: '/brand/copilot.webp',
  grok: '/brand/grok.webp',
  perplexity: '/brand/perplexity.webp',
};

type EngineRouteOption = {
  transport_provider: TransportProvider;
  model: string;
  surface_kind: SurfaceKind;
  credential_shape: CredentialShape;
};

type CredentialShape = 'key' | 'basic';

function credentialShapeFor(transport: TransportProvider): CredentialShape {
  return transport === 'dataforseo' ? 'basic' : 'key';
}

export type EngineCardModel = {
  logical_engine: LogicalEngine;
  label: string;
  route: EngineRouteOption | null;
  state: ProviderConnectionState;
  latest_probe: ProviderConnectionStateEntry['latest_probe'];
};

export function buildEngineCards(
  catalog: ProviderCatalog | undefined,
  states?: readonly ProviderConnectionStateEntry[],
): EngineCardModel[] {
  const byKey = new Map((states ?? []).map((entry) => [entry.key, entry]));

  return (catalog?.engines ?? []).map(({ logical_engine: engine, label, routes }) => {
    const approvedRoute = routes[0];
    const route: EngineRouteOption | null = approvedRoute
      ? {
          transport_provider: approvedRoute.transport_provider,
          model: approvedRoute.transport_model,
          surface_kind: approvedRoute.surface_kind,
          credential_shape: credentialShapeFor(approvedRoute.transport_provider),
        }
      : null;
    const entry = byKey.get(engine) ?? byKey.get(`provider.${engine}`);
    return {
      logical_engine: engine,
      label,
      route,
      state: entry?.state ?? ('missing' as const),
      latest_probe: entry?.latest_probe ?? null,
    };
  });
}

function isConnectable(model: EngineCardModel): boolean {
  return model.route !== null;
}

export type ProviderGroup = {
  transport: TransportProvider;
  label: string;
  credential_shape: CredentialShape;
  engines: EngineCardModel[];
};

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

export function transportForEngine(
  groups: readonly ProviderGroup[],
  engine: LogicalEngine,
): TransportProvider | null {
  return (
    groups.find((group) => group.engines.some((card) => card.logical_engine === engine))
      ?.transport ?? null
  );
}

export function connectionForTransport(
  connections: ProviderConnection[],
  transport: TransportProvider,
): ProviderConnection | undefined {
  return connections.find((c) => c.transport_provider === transport);
}

export function isConfigured(connection: ProviderConnection | undefined): boolean {
  return Boolean(connection?.api_key_set);
}

export function isVerified(connection: ProviderConnection | undefined): boolean {
  return isConfigured(connection) && connection?.last_test_status === 'ok';
}

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
