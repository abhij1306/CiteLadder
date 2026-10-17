/** Connected-data policy and persisted evidence vocabulary. */
import integrationRuntime from './integrations.json' with { type: 'json' };
import trafficRuntime from './traffic.json' with { type: 'json' };
import referralRuntime from './referrals.json' with { type: 'json' };
import analyticsRuntime from './analytics.json' with { type: 'json' };
import { validateReferralRules } from './referral-rules.ts';
import { compareText } from '../text-order.ts';

validateReferralRules(referralRuntime);

export const integrations = {
  ...integrationRuntime,
  settings: { ...integrationRuntime.settings },
  contracts: { ...integrationRuntime.contracts },
  // Lifetime of an integration's OAuth state.
  state_ttl_seconds: {
    env: ['OAUTH_STATE_TTL_SECONDS'],
    type: 'int',
    default: 600,
    exclusive_minimum: 0,
  },
};
const dimensionArity = Object.fromEntries(
  Object.entries(integrations.datasets).map(([id, dataset]) => [id, dataset.dimensions.length]),
);
const datasetConstants = Object.fromEntries(
  Object.keys(integrations.datasets).map((id) => [`DATASET_${id.toUpperCase()}`, id]),
) as { [Id in keyof typeof integrations.datasets as `DATASET_${Uppercase<Id>}`]: Id };
export const traffic = {
  ...trafficRuntime,
  ...datasetConstants,
  dimension_key_separator: integrations.dimension_separator,
  dimension_arity: dimensionArity,
  PERFORMANCE_UNAVAILABLE_DIMENSIONS: Object.entries(trafficRuntime.PERFORMANCE_DIMENSION_DATASETS)
    .filter(([, id]) => integrations.excluded_datasets.includes(id))
    .map(([dimension]) => dimension)
    .sort(compareText),
  PERFORMANCE_DATASET_DIMENSIONS: Object.fromEntries(
    Object.entries(trafficRuntime.PERFORMANCE_DIMENSION_DATASETS).map(([dimension, id]) => [
      id,
      dimension,
    ]),
  ),
};
const tasks = { ...analyticsRuntime.tasks };
const taskKinds = Object.values(tasks).sort(compareText);
export const analytics = {
  ...analyticsRuntime,
  tasks,
  task_kinds: taskKinds,
  ts_owned_task_kinds: taskKinds,
  worker_settings: { ...analyticsRuntime.worker_settings },
  default_granularity: traffic.TRAFFIC_GRANULARITY_DAY,
  snapshot_granularities: traffic.TRAFFIC_SNAPSHOT_GRANULARITIES,
  snapshot_window_days: Object.values(analyticsRuntime.preset_range_days).sort((a, b) => a - b),
};
export const referrals = {
  ...referralRuntime,
  dimension_key_separator: integrations.dimension_separator,
  dimension_arity: Object.fromEntries(
    Object.values(referralRuntime.datasets).map((id) => [id, dimensionArity[id]]),
  ),
};
