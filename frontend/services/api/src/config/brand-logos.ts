/** Brand logo acquisition and cache policy. */
export const brandLogos = {
  status_ready: 'ready',
  status_failed: 'failed',
  request_timeout_seconds: 4,
  max_redirects: 3,
  max_html_bytes: 2097152,
  max_image_bytes: 262144,
  max_candidates: 6,
  fetch_concurrency: 4,
  refresh_timeout_seconds: 10,
  success_cache_seconds: 604800,
  failure_cache_seconds: 86400,
  cache_max_age_seconds: 86400,
  fallback_path: '/favicon.ico',
  image_content_types: [
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/vnd.microsoft.icon',
    'image/webp',
    'image/x-icon',
  ],
};
