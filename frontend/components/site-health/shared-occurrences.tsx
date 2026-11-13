import { AskAgentLink } from '@/components/agent/ask-agent-link';
import { EvidenceLine } from '@/components/site-health/issue-evidence';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { insetClasses, ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { SiteIssue } from '@citeladder/contracts';
import { issueTitle } from '@/lib/site-health/issues';
import {
  sharedEvidenceLead,
  sharedPagesLabel,
  type OccurrenceEntry,
} from '@/lib/site-health/occurrence-groups';
import { pageKindLabel } from '@/lib/site-health/page-kinds';
import { pageDisplayTitle } from '@/lib/site-health/status';

/**
 * Evidence shared by several pages is usually one template element, so the
 * question is the one fix that clears it everywhere. The scope is built from
 * the counts, not from the label the reader sees, and claims no more than the
 * loaded rows prove.
 */
type SharedIssue = Pick<SiteIssue, 'group_id' | 'title' | 'rule_id'>;

function sharedAskAgentPrompt(issue: SharedIssue, evidence: string, scope: SharedScope): string {
  const reach = scope.complete
    ? `${scope.pageCount} of the issue's ${scope.totalPageCount} affected pages`
    : `${scope.pageCount} of the ${scope.loadedPageCount} affected pages loaded so far; the issue affects ${scope.totalPageCount} pages`;
  return `Analyze the Site Health issue "${issueTitle(issue)}" where the same evidence, ${evidence}, was found on several pages (${reach}). Check whether it comes from one shared template or component and propose the one fix that clears it on every page.`;
}

type SharedScope = Parameters<typeof sharedPagesLabel>[0];

/**
 * Evidence several pages share, said once: the element, how many pages carry
 * it, one question for all of them, then the pages themselves. The handoff
 * names the issue group without a page, since the question is the fix that
 * clears every page at once.
 */
export function SharedOccurrences({
  issue,
  entry,
  crawlId,
  scope,
}: Readonly<{
  issue: SharedIssue;
  entry: Extract<OccurrenceEntry, { kind: 'shared' }>;
  crawlId: string;
  scope: SharedScope;
}>) {
  return (
    <Stack as="li" gap="workspace" className={ledgerItemClasses()}>
      <div className={insetClasses()}>
        <EvidenceLine
          lead={sharedEvidenceLead(entry.ruleId)}
          facts={entry.facts}
          text="itemTitle"
        />
        <span className="type-caption tabular-nums">{sharedPagesLabel(scope)}</span>
        <AskAgentLink
          appearance="text"
          handoff={{
            issueGroup: { crawlId, groupId: issue.group_id },
            prompt: sharedAskAgentPrompt(issue, entry.facts.join(', '), scope),
            skillId: 'technical_health',
          }}
        >
          Ask agent about these pages
        </AskAgentLink>
      </div>
      <ul className={ledgerClasses()}>
        {entry.occurrences.map((occurrence) => (
          <li key={occurrence.occurrence_id} className={ledgerItemClasses()}>
            <AffectedPageLink
              crawlId={crawlId}
              siteUrlId={occurrence.site_url_id}
              title={occurrence.title}
              url={occurrence.display_url}
              pageKind={occurrence.page_kind}
            />
          </li>
        ))}
      </ul>
    </Stack>
  );
}

/**
 * One affected page, linking to its detail: its title with its kind at the
 * row's end, bound 4 over its URL. The URL keeps to one line (the full
 * address in its tooltip), so a long query string never stacks the row.
 */
export function AffectedPageLink({
  crawlId,
  siteUrlId,
  title,
  url,
  pageKind,
}: Readonly<{
  crawlId: string;
  siteUrlId: string;
  title: string | null;
  url: string;
  pageKind: string | null;
}>) {
  return (
    <TextLink
      text="itemTitle"
      className="block min-w-0"
      href={`/site/crawls/${crawlId}/pages/${siteUrlId}`}
    >
      <Stack as="span" gap="tight" className="min-w-0">
        <Inline as="span" className="items-baseline justify-between">
          <span className={textRole('itemTitle', 'min-w-0 [overflow-wrap:anywhere]')}>
            {pageDisplayTitle(title, url)}
          </span>
          {pageKind ? (
            <span className="type-caption shrink-0">{pageKindLabel(pageKind)}</span>
          ) : null}
        </Inline>
        <span className="type-caption min-w-0 truncate tabular-nums" title={url}>
          {url}
        </span>
      </Stack>
    </TextLink>
  );
}
