/** UI-only bounds and defaults. Product metrics remain server-owned. */
export const appPolicy = {
  version: '1.0.0',
  historyDays: 30,
  pageSize: 50,
  maxResultBytes: 1_000_000,
  requestTimeoutMs: 30_000,
  metrics: [
    { value: 'brand_mention_rate', label: 'Brand mention rate' },
    { value: 'owned_citation_rate', label: 'Owned citation rate' },
  ],
} as const;
