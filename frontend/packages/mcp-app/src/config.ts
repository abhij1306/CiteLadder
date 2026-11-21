export const appPolicy = {
  version: '1.0.0',
  historyDays: 30,
  pageSize: 50,
  maxResultBytes: 1_000_000,
  requestTimeoutMs: 30_000,
} as const;
