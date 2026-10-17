/** Site Health site authorship policy. */
export const siteAuthorship = {
  _name_chars: String.raw`\wÀ-ÖØ-öø-ɏ'’`,
  byline_pattern: String.raw`\b(?:(?i:written|reviewed)\s+(?i:by)|[Bb]y)\s+[A-Z][\wÀ-ÖØ-öø-ɏ'’-]+(?:\s+[A-Z][\wÀ-ÖØ-öø-ɏ'’-]+){1,2}\b`,
  profile_link_attribution_prefix_pattern: String.raw`^(?:(?i:written|reviewed|maintained|published)\s+(?i:by)|[Bb]y)\s+`,
  visible_author_name_pattern: String.raw`^[A-Z][\wÀ-ÖØ-öø-ɏ'’-]+(?:\s+[A-Z][\wÀ-ÖØ-öø-ɏ'’-]+){0,3}$`,
  visible_publisher_pattern: String.raw`\b(?i:maintained|published)\s+(?i:by)\s+(?:(?i:the)\s+)?([A-Z](?:[\wÀ-ÖØ-öø-ɏ'’&-]|\.(?=[\wÀ-ÖØ-öø-ɏ'’&-]))*(?:\s+(?:[A-Z](?:[\wÀ-ÖØ-öø-ɏ'’&-]|\.(?=[\wÀ-ÖØ-öø-ɏ'’&-]))*|team|for|of|and|the)){0,4})(?=\s*(?:\s+(?i:from)\b|[.,;]|$))`,
  date_pattern: String.raw`(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b)`,
  byline_metadata_suffix_pattern: String.raw`[,;·—-]?\s*(?:(?i:published|updated)\s+)?(?:(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b))[.]?`,
  short_date_pattern: String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|январ[ья]|феврал[ья]|март(?:а)?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август(?:а)?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\.?\s+\d{1,2},?\s+\d{4}`,
  visible_author_node_tokens: ['author', 'byline'],
  visible_author_heading_exclusions: ['about us', 'contact us', 'meet the team', 'our team'],
  visible_date_node_tokens: [
    'byline',
    'date',
    'datemodified',
    'datepublished',
    'published',
    'updated',
  ],
};
