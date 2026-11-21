import { z } from 'zod';

import { policy } from '../config.ts';
import { hash } from '../crypto-text.ts';
import type { CandidatePage, CitedUrl } from './load.ts';

export const clusterResponseSchema = z.object({
  angles: z.array(z.object({ label: z.string(), member_ids: z.array(z.string()) })),
});
export type ClusterResponse = z.infer<typeof clusterResponseSchema>;

export const matchResponseSchema = z.object({
  matches: z.array(z.object({ angle_id: z.string(), owned_page_id: z.string().nullable() })),
});
export type MatchResponse = z.infer<typeof matchResponseSchema>;

const clusterSystem = (maxLabelChars: number) =>
  [
    'You group web pages that AI answer engines cited for one topic into content angles:',
    'the kinds of content a site publishes, such as "pricing comparison" or "setup guide".',
    'You only group and name the pages you are given; each has a title, a domain and a URL path.',
    'Rules:',
    '- Use only the page IDs given. Never invent a page.',
    '- Group only content pages: articles, guides, how-tos, comparisons, listicles, reviews and case studies.',
    '- Leave out product pages, product category, collection or range listings, store or brand home pages, and search or tag pages.',
    '- Put each page in at most one angle. Leave out a page that fits no angle.',
    '- Every angle has at least one page.',
    `- Write each label in the requested language, in at most ${maxLabelChars} characters.`,
    '- A label names the content, never a brand, a claim, a count or a fact.',
    'Answer with JSON only: {"angles": [{"label": string, "member_ids": [string]}]}.',
  ].join('\n');

const MATCH_SYSTEM = [
  "For each content angle, pick the one page of the user's own site that already covers it,",
  "from that angle's candidates only, or null when none of them does.",
  "A page covers an angle when the angle's subject is the page's main subject;",
  'a page that only mentions it does not.',
  'Rules:',
  '- Answer once for every angle given, using its ID.',
  "- Use only that angle's candidate page IDs, or null.",
  'Answer with JSON only: {"matches": [{"angle_id": string, "owned_page_id": string | null}]}.',
].join('\n');

export const memberId = (index: number) => `u${index + 1}`;
export const pageId = (index: number) => `p${index + 1}`;
export const angleId = (index: number) => `a${index + 1}`;

type Prompt = { system: string; user: string; inputHash: string };

const prompt = (system: string, payload: unknown): Prompt => {
  const user = JSON.stringify(payload, null, 1);
  return { system, user, inputHash: hash(`${system}\n${user}`) };
};

export function clusterPrompt(input: {
  language: string;
  maxLabelChars: number;
  urls: readonly CitedUrl[];
}): Prompt {
  return prompt(clusterSystem(input.maxLabelChars), {
    language: input.language,
    pages: input.urls.map((url, index) => ({
      id: memberId(index),
      title: url.title,
      domain: url.domain,
      path: urlPath(url.canonicalUrl),
    })),
  });
}

function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function matchPrompt(input: {
  language: string;
  angles: readonly { label: string; titles: readonly string[]; candidates: readonly string[] }[];
  pages: readonly CandidatePage[];
  pageIds: ReadonlyMap<string, string>;
}): Prompt {
  return prompt(MATCH_SYSTEM, {
    language: input.language,
    angles: input.angles.map((angle, index) => ({
      id: angleId(index),
      label: angle.label,
      cited_titles: angle.titles.slice(0, policy.content_optimization.match_max_titles),
      candidate_ids: angle.candidates.map((siteUrlId) => input.pageIds.get(siteUrlId)),
    })),
    pages: input.pages.map((page) => ({
      id: input.pageIds.get(page.siteUrlId),
      title: page.title,
      headings: page.headings.slice(0, policy.content_optimization.match_max_headings),
      excerpt: page.excerpt,
    })),
  });
}
