/** HTTP error defaults and retry classification. */
import type { ApiErrorCode } from '@citeladder/contracts/error-codes';

export const errors = {
  status_default_code: {
    '400': 'bad_request',
    '401': 'unauthorized',
    '403': 'forbidden',
    '404': 'not_found',
    '405': 'method_not_allowed',
    '409': 'conflict',
    '410': 'gone',
    '413': 'payload_too_large',
    '415': 'unsupported_media_type',
    '422': 'validation_error',
    '429': 'rate_limited',
    '500': 'internal_error',
    '502': 'bad_gateway',
    '503': 'service_unavailable',
    '504': 'gateway_timeout',
  },
  fallback_code: 'http_error',
  internal_error_code: 'internal_error',
  retryable_statuses: [408, 429],
} satisfies {
  status_default_code: Record<string, ApiErrorCode>;
  fallback_code: ApiErrorCode;
  internal_error_code: ApiErrorCode;
  retryable_statuses: number[];
};
