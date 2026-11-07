/** Service policy and validated environment overrides. */
import { ConfigError } from './config/config-error.ts';
import { executionSettings, executionSpecs } from './config/execution.ts';
import { loadWorkerSettings } from './config/analytics.ts';
import {
  Settings,
  resolveSettingSpec,
  resolveSpec,
  type Env,
  type SettingSource,
  type SettingSpec,
} from './config/settings.ts';
export { ConfigError } from './config/config-error.ts';
export { resolveSettingSpec, type SettingSource } from './config/settings.ts';
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
import { opportunities, opportunityDefaults } from './config/opportunity.ts';
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
    task_kind: 'search_intelligence_acquisition',
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

/** The host and port the service listens on. */
const listenSpecs = {
  host: { env: ['HOST'], type: 'str', default: '' },
  port: { env: ['PORT'], type: 'str', default: '' },
} satisfies Record<string, SettingSpec>;

function isSettingSpec(value: object): value is SettingSpec {
  return (
    'env' in value &&
    Array.isArray(value.env) &&
    'type' in value &&
    typeof value.type === 'string' &&
    'default' in value
  );
}

/** Every setting the policy declares, with the key it is declared under. */
function settingCatalog(): [string, SettingSpec][] {
  const catalog: [string, SettingSpec][] = [];
  const seen = new Set<object>();
  const visit = (name: string, value: unknown) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (isSettingSpec(value)) catalog.push([name, value]);
    else if (!Array.isArray(value) && !(value instanceof Set) && !(value instanceof Map))
      for (const [key, child] of Object.entries(value)) visit(key, child);
  };
  visit('policy', { policy, executionSpecs, listenSpecs });
  return catalog;
}
const catalog = settingCatalog();

/** Resolve and validate every catalogued setting once from `env`. */
function resolveSettings(env: Env): Settings {
  return new Settings(catalog, env);
}

/** Pool, timeout and TLS settings shared by the service and terminal operators. */
export function databaseSettings(source: SettingSource) {
  const setting = (name: keyof typeof policy.settings) => resolveSetting(name, source);
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

function resolveSetting(name: keyof typeof policy.settings, source: SettingSource): unknown {
  return resolveSpec(name, policy.settings[name], source);
}

export type ServiceConfig = {
  /** Every catalogued setting, resolved and validated once at startup. */
  settings: Settings;
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
function productionSecretProblems(source: SettingSource): string[] {
  const secrets = {
    ENCRYPTION_KEY: String(resolveSetting('encryption_key', source)),
    REFERRAL_HASH_SALT: String(resolveSetting('referral_hash_salt', source)),
    API_KEY_PEPPER: String(resolveSetting('api_key_pepper', source)),
  };
  const values = Object.values(secrets);
  const issues = Object.entries(secrets)
    .filter(([, value]) => secretIsWeak(value))
    .map(([name]) => `${name} does not meet the production strength policy`);
  if (new Set(values).size !== values.length)
    issues.push('application secrets must be independent');
  // MCP is optional, but once enabled its token grants read and write access.
  const mcpToken = String(resolveSettingSpec(mcp.settings.token, source));
  if (mcpToken && secretIsWeak(mcpToken))
    issues.push(
      `MCP_TOKEN does not meet the production strength policy (at least ${policy.secret_policy.min_bytes} bytes of random characters, e.g. \`openssl rand -hex 32\`)`,
    );
  return issues;
}

export function assertDeployable(config: ServiceConfig, force = false): void {
  if (isDevelopmentEnv(config.appEnv) && !force) return;
  const issues = productionSecretProblems(config.settings);
  if (issues.length) throw new ConfigError(issues.join('; '));
}

// Auxiliary owners resolve the same startup input. Keep it out of loggable
// configuration objects because an environment can contain unrelated secrets.
/**
 * Resolve the service configuration from `env` (defaults to `process.env`):
 * every catalogued setting is resolved and validated here, once, and owners
 * read `config.settings` instead of the environment.
 */
export function loadConfig(env: Env = process.env): ServiceConfig {
  const settings = resolveSettings(env);
  const values = <K extends string>(specs: Record<K, SettingSpec>) =>
    Object.fromEntries(
      Object.entries<SettingSpec>(specs).map(([name, spec]) => [name, settings.of(spec)]),
    ) as Record<K, unknown>;
  validateSiteHealthSettings(values(siteHealth.settings));
  validateJevSettings(values(jev));
  loadWorkerSettings(settings);
  const setting = (name: keyof typeof policy.settings) => resolveSetting(name, settings);
  const config: ServiceConfig = {
    settings,
    execution: executionSettings(settings),
    appName: setting('app_name') as string,
    appEnv: setting('app_env') as string,
    // Loopback by default: there is no login, so binding every interface is an
    // explicit choice (the Docker image sets HOST=0.0.0.0 behind a loopback port).
    host: String(settings.of(listenSpecs.host)).trim() || '127.0.0.1',
    port: parsePort(String(settings.of(listenSpecs.port))),
    databaseUrl: setting('database_url') as string,
    database: databaseSettings(settings),
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
      limits: values(policy.abuse) as ServiceConfig['auth']['limits'],
    },
    readinessTimeoutMs: policy.api.readiness_timeout_seconds * 1000,
  };
  assertDeployable(config);
  return config;
}
