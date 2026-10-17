import { OpportunityKvRow } from '@/components/opportunities/opportunity-kv-row';
import { TextLink } from '@/components/ui/text-link';
import { Label } from '@/components/ui/typography';
import type { OpportunityDetail } from '@/lib/api/types';
import { formatAudited } from '@/lib/site-health/status';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { ledgerClasses } from '@/components/ui/workspace';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One deep-link row in the Source list (label + text link, like the tables). */
function SourceLink({
  label,
  href,
  linkText,
}: Readonly<{ label: string; href: string; linkText: string }>) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="type-caption shrink-0">{label}</span>
      <TextLink href={href} text="itemTitle">
        {linkText}
      </TextLink>
    </div>
  );
}

/**
 * Customer-useful source links for the finding. Persistence provenance stays
 * in the API for auditability but is not product copy.
 */
export function OpportunitySummarySection({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  const timeZone = useDisplayTimeZone();
  const evidence = detail.evidence;
  const auditId = asString(evidence.audit_id);
  const crawlId = asString(evidence.crawl_id);
  const siteUrlId = asString(evidence.site_url_id);

  return (
    <section className="grid gap-2">
      <Label>Supporting result</Label>
      <div className={ledgerClasses()}>
        <OpportunityKvRow label="Found" value={formatAudited(detail.created_at, timeZone)} />
        {auditId ? (
          <SourceLink label="Visibility review" href={`/runs/${auditId}`} linkText="View result" />
        ) : null}
        {crawlId && siteUrlId ? (
          <SourceLink
            label="Website page"
            href={`/site/crawls/${crawlId}/pages/${siteUrlId}`}
            linkText="View page"
          />
        ) : null}
        {detail.target_prompt_id ? (
          <SourceLink label="Question" href="/prompts" linkText="Open prompt library" />
        ) : null}
      </div>
    </section>
  );
}
