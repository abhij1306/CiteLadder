/** Service policy and validated environment overrides. */
import { ConfigError } from './config/config-error.ts';
import { executionSettings } from './config/execution.ts';
export { ConfigError } from './config/config-error.ts';
import { brandEvidence } from './config/brand-evidence.ts';
import { abuse } from './config/abuse.ts';
import { errors } from './config/errors.ts';
import { compareText } from './text-order.ts';
import agentRuntime from './config/agent-runtime.json' with { type: 'json' };
import modelGateway from './config/model-gateway.json' with { type: 'json' };
import { discovery } from './config/discovery.ts';
import promptLibrary from './config/prompt-library.json' with { type: 'json' };
import api from './config/api.json' with { type: 'json' };
import searchIntelligence from './config/search-intelligence.json' with { type: 'json' };
import demand from './config/demand.json' with { type: 'json' };
import { audits, visibility, selectableEngines } from './config/audits.ts';
import { providers, dataforseo } from './config/providers.ts';
import costs from './config/costs.json' with { type: 'json' };
import brandIdentity from './config/brand-identity.json' with { type: 'json' };
import workspaceRuntime from './config/workspaces.json' with { type: 'json' };
import authRuntime from './config/auth-runtime.json' with { type: 'json' };
import queue from './config/queue.json' with { type: 'json' };
import publicApi from './config/public-api.json' with { type: 'json' };
import { integrations, traffic, analytics, referrals } from './config/connected-data.ts';
import integrationCredentials from './config/integration-credentials.json' with { type: 'json' };
import { siteHealth, siteHealthRuntime } from './config/site-health.ts';
import { crawlers } from './config/crawlers.ts';
import { crawlLogs } from './config/crawl-logs.ts';
import { validateSiteHealthSettings } from './config/site-health/validation.ts';
import { commerce, commerceShelf } from './config/commerce.ts';
import { auditSchedules } from './config/audit-schedules.ts';
import { industryLibrary } from './config/industry-library.ts';
import {
  opportunities,
  opportunityDeclaration,
  opportunityDefaults,
} from './config/opportunity.ts';
import { earnedActions } from './config/earned-actions.ts';
import { actions } from './config/actions.ts';
import { sourcePatterns } from './config/source-patterns.ts';
import { sourcePages, sourcePageVocabulary, urlIdentity } from './config/source-pages.ts';
import { jev, quality, qualityGatesReported, validateJevSettings } from './config/jev.ts';
import { contentDifferentiation } from './config/content-differentiation.ts';
import { agentContext } from './config/agent-context.ts';
import { projectReads } from './config/projects.ts';
import { agentSkills } from './config/agent-skills.ts';
import { mcp } from './config/mcp.ts';
import { promptGeneration } from './config/prompt-generation.ts';
import { brandLogos } from './config/brand-logos.ts';
import { internalLinks } from './config/internal-links.ts';
import { perception } from './config/perception.ts';

type SettingSpec = {
  env: string[];
  type: string;
  default: unknown;
  values?: unknown[];
  minimum?: number;
  exclusive_minimum?: number;
  maximum?: number;
  exclusive_maximum?: number;
};

export const policy = {
  development_env_names: api.development_env_names,
  secret_policy: authRuntime.secret_policy,
  crawlers,
  crawl_logs: crawlLogs,
  task_queue: queue,
  api,
  settings: { ...api.settings, ...integrationCredentials, ...authRuntime.settings },
  integrations,
  dataforseo,
  costs,
  analytics,
  referrals,
  search_intelligence: {
    ...searchIntelligence,
    task_kind: analytics.tasks.search_intelligence_acquisition,
    connection_test_ok: providers.test_status_ok,
  },
  demand: {
    ...demand,
    query_page_dataset: traffic.DATASET_GSC_QUERY_PAGE_DAILY,
  },
  visibility: { ...visibility, ...promptLibrary.cohorts },
  projects: {
    ...projectReads,
    prompt_set_name: promptLibrary.prompt_set_name,
    min_repetitions: audits.min_repetitions,
    max_repetitions: audits.max_repetitions,
  },
  errors,
  agent: { ...agentRuntime },
  abuse,
  audit_schedules: {
    ...auditSchedules,
    selectable_engines: selectableEngines,
    min_interval_minutes: auditSchedules.settings.min_interval_minutes,
  },
  discovery: { ...discovery, industry_library: industryLibrary },
  source_pages: sourcePages,
  audits: { ...audits, url_identity: urlIdentity, commerce_shelf: commerceShelf },
  commerce: {
    ...commerce,
  },
  opportunity: {
    ...opportunityDefaults,
    measurement_policy_key: audits.constants.measurement_policy_key,
    declaration: opportunityDeclaration,
    opportunities: { ...opportunities },
    actions: { ...actions },
    earned_actions: earnedActions,
    source_patterns: { ...sourcePatterns },
    source_pages: { ...sourcePageVocabulary },
    tracking_query_params: siteHealth.tracking_params,
    refresh: {
      ...opportunityDefaults.refresh,
      finding_class_defect: 'defect',
      change_analyzer_version: siteHealth.change_intel.analyzer_version,
      change_class_regression: siteHealth.change_intel.class_regression,
      change_class_critical: siteHealth.change_intel.class_critical,
      change_max_observations: siteHealth.change_intel.max_observations,
      change_state_available: siteHealth.change_intel.state_available,
      content_change_field: siteHealth.change_intel.change_field,
      source_page_outcome_inspected: sourcePageVocabulary.INSPECTION_INSPECTED,
    },
  },
  models: { ...modelGateway, jev, quality },
  workspaces: workspaceRuntime,
  public_api: publicApi,
  providers,
  content_differentiation: {
    ...contentDifferentiation,
    stop_words: demand.stop_words,
  },
  site_health: siteHealth,
  site_health_runtime: siteHealthRuntime,
  web_fetch: siteHealth.web_fetch,
  traffic: {
    ...traffic,
    url_schemes: siteHealth.web_fetch.schemes,
    url_ports: siteHealth.web_fetch.ports,
    ignored_query_keys: [...siteHealth.tracking_params, ...siteHealth.ignored_query_keys].sort(
      compareText,
    ),
  },
  agent_context: agentContext,
  agent_skills: agentSkills,
  mcp: {
    ...mcp,
    constants: {
      ...mcp.constants,
      api_request_body_max_bytes: api.request_body_max_bytes,
    },
  },
  prompts: {
    ...promptLibrary.prompts,
    generation: promptGeneration,
    candidate: {
      ...promptLibrary.prompts.candidate,
      quality_gates_reported: qualityGatesReported,
    },
  },
  brand_identity: {
    ...brandIdentity,
    suggestion_pending: audits.observed_competitors.status_pending,
    suggestion_accepted: audits.observed_competitors.status_accepted,
  },
  brand_evidence: brandEvidence,
  brand_logos: brandLogos,
  internal_links: internalLinks,
  perception,
};

const TRUE_VALUES = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_VALUES = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

function envValue(spec: SettingSpec, env: Record<string, string | undefined>): string | undefined {
  // Environment aliases are case-insensitive.
  const byLowerName = new Map(
    Object.entries(env).map(([name, value]) => [name.toLowerCase(), value]),
  );
  for (const name of spec.env) {
    const value = byLowerName.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function checkBounds(name: string, value: number, spec: SettingSpec): number {
  if (spec.exclusive_minimum !== undefined && value <= spec.exclusive_minimum) {
    throw new ConfigError(`${name} must be > ${spec.exclusive_minimum}`);
  }
  if (spec.minimum !== undefined && value < spec.minimum) {
    throw new ConfigError(`${name} must be >= ${spec.minimum}`);
  }
  if (spec.maximum !== undefined && value > spec.maximum) {
    throw new ConfigError(`${name} must be <= ${spec.maximum}`);
  }
  if (spec.exclusive_maximum !== undefined && value >= spec.exclusive_maximum) {
    throw new ConfigError(`${name} must be < ${spec.exclusive_maximum}`);
  }
  return value;
}

function parseInteger(name: string, raw: string, spec: SettingSpec): number {
  if (!/^[+-]?\d+$/u.test(raw.trim())) throw new ConfigError(`${name} must be an integer`);
  return checkBounds(name, Number(raw.trim()), spec);
}

function parseFloatSetting(name: string, raw: string, spec: SettingSpec): number {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(value)) throw new ConfigError(`${name} must be a number`);
  return checkBounds(name, value, spec);
}

function parseBoolean(name: string, raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new ConfigError(`${name} must be a boolean`);
}

function parseSetting(name: string, spec: SettingSpec, raw: string): unknown {
  switch (spec.type) {
    case 'int':
      return parseInteger(name, raw, spec);
    case 'float':
      return parseFloatSetting(name, raw, spec);
    case 'bool':
      return parseBoolean(name, raw);
    case 'literal':
      if (!spec.values?.includes(raw)) {
        throw new ConfigError(`${name} must be one of ${spec.values?.join(', ')}`);
      }
      return raw;
    default:
      return raw;
  }
}

function resolveSpec(
  name: string,
  spec: SettingSpec,
  env: Record<string, string | undefined>,
): unknown {
  const raw = envValue(spec, env);
  return raw === undefined ? spec.default : parseSetting(name, spec, raw);
}

/** Pool, timeout and TLS settings shared by the service and terminal operators. */
export function databaseSettings(env: Record<string, string | undefined>) {
  const setting = (name: keyof typeof policy.settings) => resolveSetting(name, env);
  return {
    poolSize: setting('db_pool_size') as number,
    maxOverflow: setting('db_max_overflow') as number,
    poolRecycleSeconds: setting('db_pool_recycle_seconds') as number,
    poolTimeoutSeconds: setting('db_pool_timeout_seconds') as number,
    connectTimeoutSeconds: setting('db_connect_timeout_seconds') as number,
    commandTimeoutSeconds: setting('db_command_timeout_seconds') as number,
    statementTimeoutMs: setting('db_statement_timeout_ms') as number,
    lockTimeoutMs: setting('db_lock_timeout_ms') as number,
    idleTransactionTimeoutMs: setting('db_idle_transaction_timeout_ms') as number,
    sslMode: setting('db_ssl_mode') as 'disable' | 'require',
  };
}

function resolveSetting(name: string, env: Record<string, string | undefined>): unknown {
  return resolveSpec(name, policy.settings[name as keyof typeof policy.settings], env);
}

export type ServiceConfig = {
  execution: ReturnType<typeof executionSettings>;
  appName: string;
  appEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  database: {
    poolSize: number;
    maxOverflow: number;
    poolRecycleSeconds: number;
    poolTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    commandTimeoutSeconds: number;
    statementTimeoutMs: number;
    lockTimeoutMs: number;
    idleTransactionTimeoutMs: number;
    sslMode: 'disable' | 'require';
  };
  requestIdHeader: string;
  auth: {
    frontendUrl: string;
    /** Where the API is reached when it differs from `frontendUrl`. */
    publicApiUrl: string;
    /**
     * Host names the API answers to (DNS-rebinding guard): loopback, the hosts
     * of `frontendUrl` and `publicApiUrl`, and `ALLOWED_HOSTS`. `*` allows any.
     */
    allowedHosts: ReadonlySet<string>;
    /** HMAC key for public API key secrets; only the digest is stored. */
    apiKeyPepper: string;
    limits: Record<keyof typeof policy.abuse, number>;
    /** Injected provider transport for recorded-fixture tests. */
    fetch?: typeof fetch;
    /**
     * Injected for tests that act as several users: the request's user id, or
     * null for the local user. Production always acts as the local user.
     */
    actingUser?: (request: Request) => Promise<string | null>;
  };
  readinessTimeoutMs: number;
};

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Host names from URLs or bare names (`example.com`, `*`), lower-cased. */
function allowedHosts(entries: readonly string[]): ReadonlySet<string> {
  const hosts = new Set(LOOPBACK_HOSTS);
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    try {
      hosts.add(
        entry.includes('://') ? new URL(entry).hostname : new URL(`http://${entry}`).hostname,
      );
    } catch {
      if (entry === '*') hosts.add(entry);
      else throw new ConfigError(`Invalid host in ALLOWED_HOSTS: ${raw.trim()}`);
    }
  }
  return hosts;
}

// The TCP port range is a protocol fact, not policy; the default is exported.
const MAX_TCP_PORT = 65_535;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return policy.api.service_port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
    throw new ConfigError('PORT must be a TCP port number');
  }
  return port;
}

function isDevelopmentEnv(appEnv: string): boolean {
  return policy.development_env_names.includes(appEnv.trim().toLowerCase());
}

/** Deployment secret-strength admission. */
export function secretIsWeak(value: string): boolean {
  const rules = policy.secret_policy;
  return (
    new TextEncoder().encode(value).length < rules.min_bytes ||
    new Set(value).size < rules.min_unique_chars ||
    rules.insecure_values.includes(value) ||
    rules.weak_words.includes(value.trim().toLowerCase())
  );
}

/**
 * Outside development the application secrets must be strong and independent.
 * A self-hosted install has no sign-in, so these are its only secrets.
 */
function productionSecretProblems(env: Record<string, string | undefined>): string[] {
  const secrets = {
    ENCRYPTION_KEY: String(resolveSetting('encryption_key', env)),
    REFERRAL_HASH_SALT: String(resolveSetting('referral_hash_salt', env)),
    API_KEY_PEPPER: String(resolveSetting('api_key_pepper', env)),
  };
  const values = Object.values(secrets);
  const issues = Object.entries(secrets)
    .filter(([, value]) => secretIsWeak(value))
    .map(([name]) => `${name} does not meet the production strength policy`);
  if (new Set(values).size !== values.length)
    issues.push('application secrets must be independent');
  // MCP is optional, but once enabled its token grants read and write access.
  const mcpToken = String(resolveSettingSpec(mcp.settings.token, env));
  if (mcpToken && secretIsWeak(mcpToken))
    issues.push(
      `MCP_TOKEN does not meet the production strength policy (at least ${policy.secret_policy.min_bytes} bytes of random characters, e.g. \`openssl rand -hex 32\`)`,
    );
  return issues;
}

export function assertDeployable(
  config: ServiceConfig,
  env: Record<string, string | undefined>,
  force = false,
): void {
  if (isDevelopmentEnv(config.appEnv) && !force) return;
  const issues = productionSecretProblems(env);
  if (issues.length) throw new ConfigError(issues.join('; '));
}

// Auxiliary owners resolve the same startup input. Keep it out of loggable
// configuration objects because an environment can contain unrelated secrets.
const environments = new WeakMap<ServiceConfig, Record<string, string | undefined>>();
export function configEnvironment(config: ServiceConfig): Record<string, string | undefined> {
  return environments.get(config) ?? {};
}

/** Resolve the service configuration from `env` (defaults to `process.env`). */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServiceConfig {
  validateSiteHealthSettings(
    Object.fromEntries(
      Object.entries(siteHealth.settings).map(([name, spec]) => [
        name,
        resolveSettingSpec(spec, env),
      ]),
    ),
  );
  validateJevSettings(
    Object.fromEntries(
      Object.entries(jev).map(([name, spec]) => [name, resolveSettingSpec(spec, env)]),
    ) as Record<keyof typeof jev, unknown>,
  );
  const setting = (name: keyof typeof policy.settings) => resolveSetting(name, env);
  const config: ServiceConfig = {
    execution: executionSettings(env),
    appName: setting('app_name') as string,
    appEnv: setting('app_env') as string,
    // Loopback by default: there is no login, so binding every interface is an
    // explicit choice (the Docker image sets HOST=0.0.0.0 behind a loopback port).
    host: env.HOST?.trim() || '127.0.0.1',
    port: parsePort(env.PORT),
    databaseUrl: setting('database_url') as string,
    database: databaseSettings(env),
    requestIdHeader: setting('request_id_header') as string,
    auth: {
      frontendUrl: setting('frontend_url') as string,
      publicApiUrl: setting('public_api_url') as string,
      allowedHosts: allowedHosts([
        setting('frontend_url') as string,
        setting('public_api_url') as string,
        ...String(setting('allowed_hosts')).split(','),
      ]),
      apiKeyPepper: setting('api_key_pepper') as string,
      limits: Object.fromEntries(
        Object.entries(policy.abuse).map(([name, spec]) => [name, resolveSettingSpec(spec, env)]),
      ) as ServiceConfig['auth']['limits'],
    },
    readinessTimeoutMs: policy.api.readiness_timeout_seconds * 1000,
  };
  assertDeployable(config, env);
  environments.set(config, { ...env });
  return config;
}

export type WorkerSettings = {
  leaseReclaimBatchSize: number;
  drainBudgetSeconds: number;
  leaseTtlSeconds: number;
  /** Kinds that hold an external resource longer than the default lease covers. */
  leaseTtlSecondsByKind: Readonly<Record<string, number>>;
  heartbeatIntervalSeconds: number;
  taskMaxAttempts: number;
  pollIntervalSeconds: number;
  retryDelaySeconds: number;
};

/** Resolve one policy setting with its environment override. */
export function resolveSettingSpec(
  spec: SettingSpec,
  env: Record<string, string | undefined> = process.env,
): unknown {
  return resolveSpec(spec.env[0] ?? 'setting', spec, env);
}

export function activeJobRetrySeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  return resolveSpec(
    'active_job_retry_after_seconds',
    policy.abuse.active_job_retry_after_seconds,
    env,
  ) as number;
}

/** The analytics worker knobs (`ANALYTICS_*`), refusing a heartbeat slower than the lease. */
export function loadWorkerSettings(
  env: Record<string, string | undefined> = process.env,
): WorkerSettings {
  const specs = policy.analytics.worker_settings;
  const setting = (name: keyof typeof specs) => resolveSpec(name, specs[name], env) as number;
  const settings: WorkerSettings = {
    leaseReclaimBatchSize: setting('lease_reclaim_batch_size'),
    drainBudgetSeconds: setting('drain_budget_seconds'),
    leaseTtlSeconds: setting('lease_ttl_seconds'),
    leaseTtlSecondsByKind: policy.analytics.task_lease_ttl_seconds,
    heartbeatIntervalSeconds: setting('heartbeat_interval_seconds'),
    taskMaxAttempts: setting('task_max_attempts'),
    pollIntervalSeconds: setting('poll_interval_seconds'),
    retryDelaySeconds: setting('retry_delay_seconds'),
  };
  // A heartbeat slower than the lease guarantees expiry during healthy work.
  const leases = [settings.leaseTtlSeconds, ...Object.values(settings.leaseTtlSecondsByKind)];
  if (leases.some((lease) => settings.heartbeatIntervalSeconds >= lease)) {
    throw new ConfigError('heartbeat_interval_seconds must be shorter than every lease TTL');
  }
  return settings;
}
