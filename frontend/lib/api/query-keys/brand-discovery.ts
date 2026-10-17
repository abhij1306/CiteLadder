export const brandDiscoveryKeys = {
  all: ['brand-discovery'] as const,
  catalog: (workspaceId: string | null | undefined) =>
    ['brand-discovery-catalog', workspaceId ?? 'unresolved'] as const,
  detail: (workspaceId: string | null | undefined, discoveryId: string) =>
    ['brand-discovery', workspaceId ?? 'unresolved', discoveryId] as const,
};
