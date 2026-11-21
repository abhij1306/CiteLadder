import runtime from './providers.json' with { type: 'json' };
import searchRuntime from './dataforseo.json' with { type: 'json' };
import costs from './costs.json' with { type: 'json' };
import { z } from 'zod';
import { ConfigError } from './config-error.ts';

export const providers = runtime;
const engineLabels = new Map(runtime.catalog.map((entry) => [entry.key, entry.label]));
export const engineLabel = (key: string): string => engineLabels.get(key) ?? key;

const surfaceKindSchema = z.enum(['llm', 'search_ai', 'llm_scraper']);
type SurfaceKind = z.infer<typeof surfaceKindSchema>;
type RoutedEngine = keyof typeof runtime.routes;
const routeKinds = new Map<string, SurfaceKind>(
  Object.entries(runtime.routes).map(([engine, route]) => [
    engine,
    surfaceKindSchema.parse(route.surface_kind),
  ]),
);
const isRoutedEngine = (key: string): key is RoutedEngine => routeKinds.has(key);
const catalogOrder = runtime.catalog.map((entry) => entry.key).filter(isRoutedEngine);
const [firstEngine, ...otherEngines] = [
  ...catalogOrder,
  ...[...routeKinds.keys()].filter(isRoutedEngine).filter((key) => !catalogOrder.includes(key)),
];
if (!firstEngine) throw new ConfigError('The provider catalog routes no logical engine');
export const logicalEngines: readonly [RoutedEngine, ...RoutedEngine[]] = [
  firstEngine,
  ...otherEngines,
];
export const surfaceKindOf = (engine: string): SurfaceKind | null => routeKinds.get(engine) ?? null;
export const enginesOfKind = (...kinds: SurfaceKind[]): RoutedEngine[] =>
  logicalEngines.filter((engine) => {
    const kind = routeKinds.get(engine);
    return kind !== undefined && kinds.includes(kind);
  });
export const dataforseo = {
  ...searchRuntime,
  constants: { ...searchRuntime.constants },
  scraper: { ...searchRuntime.scraper },
  microusd_per_usd: costs.microusd_per_usd,
};
