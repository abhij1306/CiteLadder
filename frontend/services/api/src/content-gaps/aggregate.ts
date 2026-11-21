import { compareText } from '../text-order.ts';
import type { CitedUrl, OwnedCitation } from './load.ts';

export type AngleAggregate = {
  citationCount: number;
  domainCount: number;
  competitorCount: number;
  promptIds: string[];
  engines: string[];
  ownedCited: boolean;
  ownedCitationIds: string[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compareText);

export function aggregateAngle(
  angle: { members: readonly CitedUrl[] },
  matchedUrl: string | null,
  owned: readonly OwnedCitation[],
): AngleAggregate {
  const citations = angle.members.flatMap((member) => member.citations);
  const promptIds = sorted(citations.map((citation) => citation.promptId));
  const prompts = new Set(promptIds);
  const ownedCitationIds =
    matchedUrl === null
      ? []
      : sorted(
          owned
            .filter((url) => url.canonicalUrl === matchedUrl)
            .flatMap((url) => url.citations)
            .filter((citation) => prompts.has(citation.promptId))
            .map((citation) => citation.id),
        );
  return {
    citationCount: citations.length,
    domainCount: new Set(angle.members.map((member) => member.domain.toLowerCase())).size,
    competitorCount: new Set(
      angle.members
        .filter((member) => member.classification === 'competitor')
        .map((member) => (member.matchedCompetitor ?? member.domain).toLowerCase()),
    ).size,
    promptIds,
    engines: sorted(citations.map((citation) => citation.engine)),
    ownedCited: ownedCitationIds.length > 0,
    ownedCitationIds,
  };
}
