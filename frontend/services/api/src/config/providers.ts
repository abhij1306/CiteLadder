/** Provider catalog, frozen routes and execution/pricing policy. */
import runtime from './providers.json' with { type: 'json' };
import searchRuntime from './dataforseo.json' with { type: 'json' };
import costs from './costs.json' with { type: 'json' };

export const providers = runtime;
export const dataforseo = {
  ...searchRuntime,
  constants: { ...searchRuntime.constants },
  scraper: { ...searchRuntime.scraper },
  microusd_per_usd: costs.microusd_per_usd,
};
