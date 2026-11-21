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

type SharedIssue = Pick<SiteIssue, 'group_id' | 'title' | 'rule_id'>;

function sharedAskAgentPrompt(issue: SharedIssue, evidence: string, scope: SharedScope): string {
  const reach = scope.complete
    ? `${scope.pageCount} of the issue's ${scope.totalPageCount} affected pages`
    : `${scope.pageCount} of the ${scope.loadedPageCount} affected pages loaded so far; the issue affects ${scope.totalPageCount} pages`;
  return `Analyze the Website issue "${issueTitle(issue)}" where the same evidence, ${evidence}, was found on several pages (${reach}). Check whether it comes from one shared template or component and propose the one fix that clears it on every page.`;
}

type SharedScope = Parameters<typeof sharedPagesLabel>[0];

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
        <EvidenceLine lead={sharedEvidenceLead(entry.ruleId)} facts={entry.facts} text="body" />
        <span className="type-caption">{sharedPagesLabel(scope)}</span>
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
      text="body"
      className="block min-w-0"
      href={`/site/crawls/${crawlId}/pages/${siteUrlId}`}
    >
      <Stack as="span" gap="tight" className="min-w-0">
        <Inline as="span" className="items-baseline justify-between">
          <span
            className={textRole('body', 'min-w-0 truncate')}
            title={pageDisplayTitle(title, url)}
          >
            {pageDisplayTitle(title, url)}
          </span>
          {pageKind ? (
            <span className="type-caption shrink-0">{pageKindLabel(pageKind)}</span>
          ) : null}
        </Inline>
        <span className="type-caption min-w-0 truncate" title={url}>
          {url}
        </span>
      </Stack>
    </TextLink>
  );
}
