import { Badge } from '@/components/ui/badge';
import { DisplayTime } from '@/components/ui/display-time';
import { Disclosure } from '@/components/ui/disclosure';
import { FactList } from '@/components/ui/facts';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { AgentPageFetchDone, AgentRevision } from '@/lib/api/agent';
import { pluralCount } from '@/lib/format';
import { severityBadgeValue, severityLabel } from '@/lib/site-health/issues';
import { issueSeveritySchema } from '@citeladder/contracts';

type PageCheck = AgentPageFetchDone['checks'][number];

/** A value as it reads on the page, or that the page has none. */
function FieldValue({ value }: Readonly<{ value: string }>) {
  if (!value.trim()) return <span className={textRole('body')}>None</span>;
  return <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>{value}</span>;
}

function CheckRow({ check }: Readonly<{ check: PageCheck }>) {
  const severity = issueSeveritySchema.safeParse(check.severity);
  return (
    <Inline as="li" gap="compact" className={ledgerItemClasses('justify-between')}>
      <span className={textRole('itemTitle')}>{check.label}</span>
      {severity.success ? (
        <Badge variant="status" value={severityBadgeValue(severity.data)}>
          {severityLabel(severity.data)}
        </Badge>
      ) : null}
    </Inline>
  );
}

/**
 * The SEO tab (E5): the page's SEO fields as the latest revision holds them,
 * and Site Health's page-local checks as they judged the page when it was
 * fetched. Editing the page does not rerun the checks, and the tab says so.
 */
export function SeoPanel({
  fields,
  fetch,
}: Readonly<{ fields: AgentRevision['fields']; fetch: AgentPageFetchDone | null }>) {
  const failing = fetch?.checks.filter((check) => check.failing) ?? [];
  const passed = (fetch?.checks.length ?? 0) - failing.length;
  return (
    <Stack gap="workspace">
      <Stack as="section" gap="compact" aria-labelledby="seo-fields">
        <h3 id="seo-fields" className={textRole('itemTitle')}>
          SEO fields
        </h3>
        {fields ? (
          <>
            <FactList
              layout="ruled"
              facts={[
                { label: 'Title tag', value: <FieldValue value={fields.title} /> },
                {
                  label: 'Meta description',
                  value: <FieldValue value={fields.meta_description} />,
                },
              ]}
            />
            {fields.json_ld.trim() ? (
              <Disclosure title="Structured data (JSON-LD)">
                <pre
                  className={textRole('caption', 'whitespace-pre-wrap [overflow-wrap:anywhere]')}
                >
                  {fields.json_ld}
                </pre>
              </Disclosure>
            ) : (
              <p className={textRole('caption')}>The page has no structured data (JSON-LD).</p>
            )}
          </>
        ) : (
          <p className={textRole('body')}>This revision has no SEO fields.</p>
        )}
      </Stack>
      <Stack as="section" gap="compact" aria-labelledby="seo-checks">
        <h3 id="seo-checks" className={textRole('itemTitle')}>
          Page checks
        </h3>
        <p className={textRole('caption')}>
          Site Health’s checks on the page as fetched
          {fetch?.fetched_at ? (
            <>
              {' '}
              on <DisplayTime value={fetch.fetched_at} />
            </>
          ) : null}
          . Editing the page doesn’t rerun them.
        </p>
        {failing.length > 0 ? (
          <ul aria-label="Checks to fix" className={ledgerClasses()}>
            {failing.map((check) => (
              <CheckRow key={check.rule_id} check={check} />
            ))}
          </ul>
        ) : (
          <p className={textRole('body')}>
            {fetch?.checks.length
              ? 'Every page check passed.'
              : 'No page checks ran on this fetch.'}
          </p>
        )}
        {failing.length > 0 && passed > 0 ? (
          <p className={textRole('caption')}>{pluralCount(passed, 'other check')} passed.</p>
        ) : null}
      </Stack>
    </Stack>
  );
}
