export const SPECULATION_RULES = {
  prefetch: [
    {
      source: 'document',
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api' } },
          { not: { href_matches: '/api/*' } },
          { not: { href_matches: '/v1/*' } },
          { not: { selector_matches: '[rel~=nofollow], [download]' } },
        ],
      },
      eagerness: 'moderate',
    },
  ],
} as const;

export const SPECULATION_RULES_JSON = JSON.stringify(SPECULATION_RULES);
