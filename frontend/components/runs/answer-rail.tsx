import { useQuery } from '@tanstack/react-query';
import { Absence } from '@/components/ui/absence';
import {
  QueryItem,
  RailItem,
  RailLine,
  RailList,
  RailCount,
  RailRank,
  RailUrl,
  RailSection,
  YouMark,
} from '@/components/ui/answer-chat';
import { BrandMark } from '@/components/ui/brand-mark';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StateBlock } from '@/components/ui/state-block';
import { StatusMark } from '@/components/ui/status-mark';
import { textRole } from '@/components/ui/typography';
import type { ExecutionEvidence, VisibilityExecutionEvidence } from '@citeladder/contracts';
import { Quote } from '@/lib/icons';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { EVIDENCE_LIMIT } from '@/lib/config/operational';
import { useProjectScope } from '@/lib/project/active-project-scope';
import type { AnswerBrand, AnswerLink, AnswerSource } from '@/lib/runs/answer-transcript';
import { classificationLabel } from '@citeladder/contracts/page-labels';
import { classificationBadgeValue } from '@/lib/runs/status';

export function BrandsRail({ brands }: Readonly<{ brands: readonly AnswerBrand[] }>) {
  return (
    <RailSection title="Brands" count={brands.length}>
      {brands.length ? (
        <RailList label="Brands, by first mention">
          {brands.map((brand) => (
            <RailItem key={brand.name}>
              <RailLine>
                <RailRank>
                  {brand.position === null ? (
                    <Absence state="unavailable" label="Position not recorded" />
                  ) : (
                    <>
                      <span className="sr-only">Position </span>
                      {brand.position}
                    </>
                  )}
                </RailRank>
                <BrandMark
                  name={brand.name}
                  logoUrl={brand.logoUrl}
                  websiteUrl={brand.websiteUrl}
                  placement="row"
                />
                <span className={textRole('body', 'min-w-0 truncate')}>{brand.name}</span>
                {brand.you ? <YouMark /> : null}
              </RailLine>
            </RailItem>
          ))}
        </RailList>
      ) : (
        <p className="type-caption text-ink-2">No tracked brand appeared in this answer.</p>
      )}
    </RailSection>
  );
}

export function SourcesRail({ sources }: Readonly<{ sources: readonly AnswerSource[] }>) {
  return (
    <RailSection title="Sources" count={sources.length}>
      {sources.length ? (
        <RailList label="Sources">
          {sources.map((source) => (
            <RailItem key={source.href ?? source.url}>
              <RailLine>
                <BrandMark
                  name={source.domain || source.url}
                  websiteUrl={source.href}
                  placement="inline"
                  entity="site"
                />
                <span className={textRole('emphasis', 'min-w-0 truncate')}>
                  {source.domain || 'Unknown domain'}
                </span>
                {source.you ? <YouMark /> : null}
                <RailCount
                  label={source.count === 1 ? 'Cited once' : `Cited ${source.count} times`}
                >
                  {source.count}
                </RailCount>
              </RailLine>
              {source.title ? (
                <span className="type-caption text-ink truncate" title={source.title}>
                  {source.title}
                </span>
              ) : null}
              <RailUrl
                href={source.href}
                text={source.url}
                trailing={
                  <StatusMark
                    variant="classification"
                    value={classificationBadgeValue(source.citation.classification)}
                  >
                    {classificationLabel(source.citation.classification)}
                  </StatusMark>
                }
              />
            </RailItem>
          ))}
        </RailList>
      ) : (
        <StateBlock
          kind="empty"
          headingLevel={3}
          icon={Quote}
          heading="No citations were captured from this response"
        />
      )}
    </RailSection>
  );
}

export function LinksRail({
  links,
  formats,
}: Readonly<{ links: readonly AnswerLink[]; formats: ExecutionEvidence['answer_formats'] }>) {
  if (formats.kind === 'observed' && links.length === 0) return null;
  return (
    <RailSection title="Links" count={formats.kind === 'observed' ? links.length : undefined}>
      {formats.kind === 'observed' ? (
        <RailList label="Links in the answer">
          {links.map((link) => (
            <RailItem key={link.href}>
              <RailLine>
                <BrandMark
                  name={link.domain}
                  websiteUrl={link.href}
                  placement="inline"
                  entity="site"
                />
                <span className={textRole('emphasis', 'min-w-0 truncate')}>{link.domain}</span>
                {link.you ? <YouMark /> : null}
                <RailCount label={link.count === 1 ? 'Linked once' : `Linked ${link.count} times`}>
                  {link.count}
                </RailCount>
              </RailLine>
              <RailUrl href={link.href} text={link.href} />
            </RailItem>
          ))}
        </RailList>
      ) : (
        <Absence state={formats.kind} />
      )}
    </RailSection>
  );
}

type FanoutRead =
  | { kind: 'loading' }
  | { kind: 'failed'; read: RetryableRead }
  | { kind: 'found'; item: VisibilityExecutionEvidence }
  | { kind: 'missing' };

function useAnswerFanout(evidence: ExecutionEvidence, promptId: string | undefined): FanoutRead {
  const { workspaceId, projectId } = useProjectScope();
  const read = useQuery(
    visibilityQueries.evidence(
      { workspaceId, projectId },
      {
        audit_id: evidence.audit_id,
        engine: evidence.logical_engine,
        prompt_id: promptId,
        limit: EVIDENCE_LIMIT,
      },
    ),
  );
  if (read.isError && !read.data) return { kind: 'failed', read };
  if (read.isPending) return { kind: 'loading' };
  const item = read.data.items.find((entry) => entry.task_id === evidence.id);
  return item ? { kind: 'found', item } : { kind: 'missing' };
}

const searchCount = (count: number) => (count === 1 ? '1 search' : `${count} searches`);

function withheld(count: number): string {
  return `${searchCount(count)} ran; the engine did not expose their wording.`;
}

function unread(count: number): string {
  return `${searchCount(count)} ran; their wording is unavailable.`;
}

function FanoutBody({
  read,
  evidence,
}: Readonly<{ read: FanoutRead; evidence: ExecutionEvidence }>) {
  if (read.kind === 'loading') return <Skeleton lines={2} />;
  if (read.kind === 'failed')
    return (
      <Notice
        kind="read"
        {...readErrorProps(read.read)}
        title="Couldn't load this answer's searches"
        fallback="The request failed or timed out."
      />
    );
  if (read.kind === 'missing')
    return evidence.search_query_count > 0 ? (
      <p className="type-caption text-ink-2">{unread(evidence.search_query_count)}</p>
    ) : (
      <p className="type-caption text-ink-2">Search queries are unavailable for this answer.</p>
    );
  const { item } = read;
  switch (item.state) {
    case 'queries_available': {
      const queries = item.search_events.filter((event) => event.query.trim());
      return (
        <RailList label="Searches the engine ran" dense>
          {queries.map((event) => (
            <QueryItem key={event.sequence}>{event.query}</QueryItem>
          ))}
        </RailList>
      );
    }
    case 'no_search':
      return <p className="type-caption text-ink-2">The engine ran no searches for this answer.</p>;
    case 'count_only':
    case 'no_exposed_queries':
      return <p className="type-caption text-ink-2">{withheld(item.search_query_count)}</p>;
    case 'unavailable':
      return (
        <p className="type-caption text-ink-2">Search queries are unavailable for this answer.</p>
      );
    default: {
      const unreachable: never = item.state;
      return unreachable;
    }
  }
}

export function FanoutRail({
  evidence,
  promptId,
}: Readonly<{ evidence: ExecutionEvidence; promptId?: string }>) {
  const read = useAnswerFanout(evidence, promptId);
  return (
    <RailSection title="Query fanouts">
      <FanoutBody read={read} evidence={evidence} />
    </RailSection>
  );
}
