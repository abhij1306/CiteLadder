const METRIC_LABELS = {
  visibility: 'Visibility',
  shareOfVoice: 'Share of voice',
  position: 'Position',
  winRate: 'Win rate',
  sentiment: 'Sentiment',
  ownedCitationRate: 'Owned citation rate',
} as const;

export const VISIBILITY_METRICS = [
  { value: 'brand_mention_rate', label: METRIC_LABELS.visibility },
  { value: 'sov', label: METRIC_LABELS.shareOfVoice },
  { value: 'avg_position', label: METRIC_LABELS.position },
  { value: 'win_rate', label: METRIC_LABELS.winRate },
  { value: 'sentiment', label: METRIC_LABELS.sentiment },
  { value: 'owned_citation_rate', label: METRIC_LABELS.ownedCitationRate },
] as const;

export const MATRIX_METRICS = [
  { value: 'mention_rate', label: METRIC_LABELS.visibility },
  { value: 'share_of_voice', label: METRIC_LABELS.shareOfVoice },
  { value: 'avg_position', label: METRIC_LABELS.position },
  { value: 'win_rate', label: METRIC_LABELS.winRate },
  { value: 'sentiment', label: METRIC_LABELS.sentiment },
] as const;

export const MATRIX_DIMENSIONS = [
  { value: 'engine', label: 'Engine' },
  { value: 'topic', label: 'Topic' },
  { value: 'market', label: 'Market' },
  { value: 'brand', label: 'Brand' },
] as const;

export const RANKING_DIMENSIONS = [
  { value: 'topic', label: 'By topic' },
  { value: 'engine', label: 'By engine' },
  { value: 'market', label: 'By market' },
] as const;

export const SHARE_OF_VOICE_HINT =
  'Share of voice: your share of every brand mention across the brands you track.';

export const WIN_RATE_HINT =
  'Of the answers that name at least one brand you track, the share that name this brand first. A brand you do not track is not counted.';

export const PERCEPTION_MIN_CLASSIFIED = 20;

export const THEME_MAP_COLUMNS = 6;

export const ANSWER_OUTCOMES = [
  { value: 'all', label: 'All answers' },
  { value: 'brand_absent', label: 'Brand absent' },
  { value: 'uncited', label: 'Brand mentioned without owned citation' },
] as const;
