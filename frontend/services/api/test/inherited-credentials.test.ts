import { expect, it } from 'vitest';
import { isInheritedCredential } from './inherited-credentials.ts';

it('refuses inherited provider credentials and secrets but keeps the local database and test settings', () => {
  const refused = [
    'DATAFORSEO_API_LOGIN',
    'DATAFORSEO_API_PASSWORD',
    'DEFAULT_AGENT_API_KEY',
    'DEFAULT_AGENT_BASE_URL',
    'DEFAULT_AGENT_MODEL',
    'TAVILY_API_KEY',
    'JWT_SECRET_KEY',
    'ENCRYPTION_KEY',
    'API_KEY_PEPPER',
    'MCP_TOKEN',
    'INTEGRATION_GOOGLE_CLIENT_ID',
    'INTEGRATION_GOOGLE_CLIENT_SECRET',
  ];
  const kept = [
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'API_TEST_DATABASE_URL',
    'DATAFORSEO_BASE_URL',
    'APP_ENV',
    'CITELADDER_DISABLE_DOTENV',
  ];
  expect([...refused, ...kept].filter(isInheritedCredential)).toEqual(refused);
});
