import type { ExecutionEvidence, Project } from '@citeladder/contracts';
import { hostOf } from '@/lib/visibility/sources';

export type AnswerBrand = Readonly<{
  name: string;
  you: boolean;
  offset: number | null;
  position: number | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  phrases: readonly string[];
}>;

export type AnswerSource = Readonly<{
  href: string | null;
  url: string;
  domain: string;
  title: string;
  count: number;
  you: boolean;
  citation: ExecutionEvidence['citations'][number];
}>;

export type AnswerLink = Readonly<{ href: string; domain: string; count: number; you: boolean }>;

export function safeCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type Mark = Pick<AnswerBrand, 'logoUrl' | 'websiteUrl'>;

function firstNamedMark(evidence: ExecutionEvidence, name: string): Mark | null {
  const first = evidence.first_named;
  if (first.kind !== 'brand' && first.kind !== 'competitor') return null;
  if (first.name.trim().toLowerCase() !== name.trim().toLowerCase()) return null;
  return { logoUrl: first.logo_url, websiteUrl: first.website_url };
}

type Named = ExecutionEvidence['named'][number];

function ownBrand(evidence: ExecutionEvidence, named: Named, project: Project | null): AnswerBrand {
  const firstBrand = evidence.first_named.kind === 'brand' ? evidence.first_named.name : '';
  const perceived = evidence.perception.find((entity) => entity.is_brand)?.entity ?? '';
  const name = project?.brand_name || named.name || firstBrand || perceived || 'Your brand';
  const mark = firstNamedMark(evidence, name);
  return {
    name,
    you: true,
    offset: named.offset,
    position: named.position,
    logoUrl: project?.brand.logo_url ?? mark?.logoUrl ?? null,
    websiteUrl: project?.website_url || mark?.websiteUrl || null,
    phrases: [...new Set([name, named.name, ...(project?.brand.aliases ?? [])].filter(Boolean))],
  };
}

function competitorBrand(
  evidence: ExecutionEvidence,
  named: Named,
  project: Project | null,
): AnswerBrand {
  const { name } = named;
  const tracked = project?.competitors.find((competitor) => competitor.name === name);
  const mark = firstNamedMark(evidence, name);
  const domain = tracked?.domains[0];
  return {
    name,
    you: false,
    offset: named.offset,
    position: named.position,
    logoUrl: tracked?.logo_url ?? mark?.logoUrl ?? null,
    websiteUrl: domain ? `https://${domain}` : (mark?.websiteUrl ?? null),
    phrases: [name, ...(tracked?.aliases ?? [])],
  };
}

export function answerBrands(
  evidence: ExecutionEvidence,
  project: Project | null,
): readonly AnswerBrand[] {
  return evidence.named.map((named) => {
    switch (named.kind) {
      case 'brand':
        return ownBrand(evidence, named, project);
      case 'competitor':
        return competitorBrand(evidence, named, project);
      default: {
        const unreachable: never = named.kind;
        return unreachable;
      }
    }
  });
}

// A markdown link that is not an image, as the analysis counts them. The text
// excludes `[` so the scan stays linear; a nested `[` still yields the same URL.
const MARKDOWN_LINK = /(?<!!)\[[^[\]]*\]\((https?:\/\/[^\s)]+)/gu;

const bareHost = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^www\./u, '');

function ownHosts(project: Project | null): readonly string[] {
  if (!project) return [];
  const site = hostOf(project.website_url);
  return [...project.owned_domains.map(bareHost), ...(site ? [site] : [])].filter(Boolean);
}

export function answerLinks(answerText: string, project: Project | null): readonly AnswerLink[] {
  const own = ownHosts(project);
  const byHref = new Map<string, AnswerLink>();
  for (const [, target = ''] of answerText.matchAll(MARKDOWN_LINK)) {
    const href = safeCitationUrl(target);
    if (!href) continue;
    const seen = byHref.get(href);
    if (seen) {
      byHref.set(href, { ...seen, count: seen.count + 1 });
      continue;
    }
    const domain = hostOf(href) ?? '';
    const you = own.some((host) => domain === host || domain.endsWith(`.${host}`));
    byHref.set(href, { href, domain, count: 1, you });
  }
  return [...byHref.values()];
}

export function answerSources(citations: ExecutionEvidence['citations']): readonly AnswerSource[] {
  const byKey = new Map<string, AnswerSource>();
  for (const citation of citations) {
    const href = safeCitationUrl(citation.url);
    const key = href ?? citation.url;
    const seen = byKey.get(key);
    if (seen) {
      byKey.set(key, { ...seen, count: seen.count + 1, you: seen.you || citation.is_owned });
      continue;
    }
    byKey.set(key, {
      href,
      url: citation.url,
      domain: citation.domain,
      title: citation.title,
      count: 1,
      you: citation.is_owned,
      citation,
    });
  }
  return [...byKey.values()];
}
