/** Audit execution, persisted vocabulary and read policy. */
import runtime from './audits.json' with { type: 'json' };
import visibilityRuntime from './visibility.json' with { type: 'json' };
import { compareText } from '../text-order.ts';
import { providers, dataforseo } from './providers.ts';
import { ConfigError } from './config-error.ts';

export const selectableEngines = providers.catalog
  .filter((entry) => entry.adapter_shipped && Object.hasOwn(providers.routes, entry.key))
  .map((entry) => entry.key)
  .sort(compareText);
export const audits = {
  ...runtime,
  analysis: { ...runtime.analysis },
  constants: { ...runtime.constants },
  selectable_engines: selectableEngines,
  route_policies: Object.fromEntries(
    Object.entries(runtime.route_policies).map(([engine, execution]) => {
      const route = providers.routes[engine as keyof typeof providers.routes];
      if (!route) throw new ConfigError(`Audit engine ${engine} has no provider route`);
      return [
        engine,
        {
          ...execution,
          reasoning_effort: route.reasoning_effort,
          reasoning_pinnable: route.reasoning_pinnable,
          representative_status: route.representative_status,
        },
      ];
    }),
  ),
};
export const visibility = {
  ...visibilityRuntime,
  dashboard_audit_statuses: [
    audits.constants.audit_status_completed,
    audits.constants.audit_status_partially_completed,
  ],
  /** Admitted and not yet settled: the Dashboard says the first audit is under way. */
  in_flight_audit_statuses: audits.constants.audit_active_statuses.filter(
    (status) => status !== audits.constants.audit_status_draft,
  ),
  measurement_policy_key: audits.constants.measurement_policy_key,
  overview_present_outcome: dataforseo.surface.outcome_ai_overview_present,
  successful_outcomes: dataforseo.surface.successful_outcomes,
};
