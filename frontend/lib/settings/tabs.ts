export const SETTINGS_TABS = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Providers' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'connections', label: 'MCP connections' },
  { value: 'api-keys', label: 'API keys' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['value'];
