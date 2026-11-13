/**
 * Scheduled crawls: each cadence's step and the scheduler's lease and retry
 * limits. A cadence steps in whole UTC days or calendar months from the
 * schedule's last occurrence.
 */
export const crawlSchedules = {
  cadences: {
    weekly: { days: 7, months: 0 },
    monthly: { days: 0, months: 1 },
  },
  settings: {
    lease_ttl_seconds: {
      env: ['CRAWL_SCHEDULE_LEASE_TTL_SECONDS'],
      type: 'float',
      default: 120,
      exclusive_minimum: 0,
    },
    claim_batch_size: {
      env: ['CRAWL_SCHEDULE_CLAIM_BATCH_SIZE'],
      type: 'int',
      default: 20,
      exclusive_minimum: 0,
    },
    failure_retry_seconds: {
      env: ['CRAWL_SCHEDULE_FAILURE_RETRY_SECONDS'],
      type: 'int',
      default: 3600,
      exclusive_minimum: 0,
    },
    max_consecutive_failures: {
      env: ['CRAWL_SCHEDULE_MAX_CONSECUTIVE_FAILURES'],
      type: 'int',
      default: 5,
      exclusive_minimum: 0,
    },
  },
};
