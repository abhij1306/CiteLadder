import type { NetSentiment, WebSearchShare as WebSearch } from '@citeladder/contracts/visibility';

import { netSentiment, pooledSentiment, type Mention } from '../perception/metrics.ts';
import type { BrandCount } from './brand-identities.ts';
import { searchOf } from './prompt-answers.ts';

type Answer = { id: string; search_used: boolean; fanout_state: string };

function shareOfVoice(named: readonly BrandCount[]): number | null {
  const total = named.reduce((sum, entry) => sum + entry.responses, 0);
  const brand = named.reduce(
    (sum, entry) => sum + (entry.kind === 'brand' ? entry.responses : 0),
    0,
  );
  return total ? brand / total : null;
}

function pooledSearch(parts: readonly Pick<WebSearch, 'searched' | 'reported'>[]): WebSearch {
  const searched = parts.reduce((sum, part) => sum + part.searched, 0);
  const reported = parts.reduce((sum, part) => sum + part.reported, 0);
  return { searched, reported, share: reported ? searched / reported : null };
}

export function promptSignals(input: {
  answered: readonly Answer[];
  named: readonly BrandCount[];
  brandMentions: ReadonlyMap<string, Mention[]> | undefined;
}) {
  const reported = input.answered.filter((answer) => searchOf(answer) !== 'not_reported');
  const { brandMentions } = input;
  return {
    share_of_voice: shareOfVoice(input.named),
    sentiment: brandMentions
      ? netSentiment(input.answered.flatMap((answer) => brandMentions.get(answer.id) ?? []))
      : null,
    web_search: pooledSearch([
      {
        searched: reported.filter((answer) => answer.search_used).length,
        reported: reported.length,
      },
    ]),
  };
}

export function pooledSignals(
  items: readonly { sentiment?: NetSentiment | null; web_search?: WebSearch }[],
  named: readonly BrandCount[],
) {
  const sentiments = items.flatMap((item) => (item.sentiment ? [item.sentiment] : []));
  return {
    share_of_voice: shareOfVoice(named),
    sentiment: sentiments.length === items.length ? pooledSentiment(sentiments) : null,
    web_search: pooledSearch(items.flatMap((item) => (item.web_search ? [item.web_search] : []))),
  };
}
