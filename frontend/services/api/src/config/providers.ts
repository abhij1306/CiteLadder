/** Provider catalog, frozen routes and execution/pricing policy. */
import runtime from './providers.json' with { type: 'json' };
import searchRuntime from './dataforseo.json' with { type: 'json' };
import costs from './costs.json' with { type: 'json' };

export const providers = runtime;
const engineLabels = new Map(runtime.catalog.map((entry) => [entry.key, entry.label]));
/** The catalogue's display name for a logical engine; a key it does not list prints as stored. */
export const engineLabel = (key: string): string => engineLabels.get(key) ?? key;
export const dataforseo = {
  ...searchRuntime,
  constants: { ...searchRuntime.constants },
  scraper: { ...searchRuntime.scraper },
  microusd_per_usd: costs.microusd_per_usd,
};
