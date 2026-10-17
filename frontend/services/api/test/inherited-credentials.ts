/** Live provider configuration a test runner must never inherit. */
export const isInheritedCredential = (name: string) =>
  /(?:_API_KEY|_CLIENT_SECRET|_CLIENT_ID)$/iu.test(name) ||
  /^DEFAULT_AGENT_(?:BASE_URL|MODEL)/iu.test(name);
