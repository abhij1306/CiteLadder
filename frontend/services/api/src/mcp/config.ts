import { configEnvironment, policy, resolveSettingSpec, type ServiceConfig } from '../config.ts';

export const mcpPolicy = policy.mcp.constants;

/** Whether stored scopes include `citeladder:write`. */
export const holdsWrite = (scopes: readonly string[]) => scopes.includes(mcpPolicy.write_scope);

const originOf = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

/**
 * MCP is served when `MCP_TOKEN` is set: a client sends it as its bearer
 * token and acts as the local user with read and write scopes.
 */
export function loadMcpConfig(
  config: ServiceConfig,
  env: Record<string, string | undefined> = configEnvironment(config),
) {
  const token = String(resolveSettingSpec(policy.mcp.settings.token, env)).trim();
  return {
    enabled: token.length > 0,
    token,
    // App links in tool results point at the browser app.
    browserOrigin: originOf(String(resolveSettingSpec(policy.settings.frontend_url, env))),
  };
}
