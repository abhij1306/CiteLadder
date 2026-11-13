/** Live provider configuration and secrets a test runner must never inherit. */
export const isInheritedCredential = (name: string) =>
  /(?:_API_KEY|_CLIENT_SECRET|_CLIENT_ID|_SECRET_KEY)$/iu.test(name) ||
  /^(?:DEFAULT_AGENT_(?:BASE_URL|MODEL)|DATAFORSEO_API_)/iu.test(name) ||
  /^(?:ENCRYPTION_KEY|API_KEY_PEPPER|MCP_TOKEN)$/iu.test(name);
