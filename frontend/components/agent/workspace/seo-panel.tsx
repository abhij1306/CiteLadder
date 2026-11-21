import { Absence } from '@/components/ui/absence';
import { StatusMark } from '@/components/ui/status-mark';
import { DisplayTime } from '@/components/ui/display-time';
import { Disclosure } from '@/components/ui/disclosure';
import { FactList } from '@/components/ui/facts';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { AgentPageFetchDone, AgentRevision } from '@/lib/api/agent';
import { pluralCount } from '@/lib/format';
import { severityLabel } from '@/lib/site-health/issues';
import { issueSeveritySchema } from '@citeladder/contracts';

type PageCheck = AgentPageFetchDone['checks'][number];

function FieldValue({ value }: Readonly<{ value: string }>) {
  if (!value.trim()) return <Absence state="none" />;
  return <span className={textRole('body', '[overflow-wrap:anywhere]')}>{value}</span>;
}

function CheckRow({ check }: Readonly<{ check: PageCheck }>) {
  const severity = issueSeveritySchema.safeParse(check.severity);
  return (
    <Inline as="li" gap="compact" className={ledgerItemClasses('justify-between')}>
      <span className={textRole('body')}>{check.label}</span>
      {severity.success ? (
        <StatusMark variant="severity" value={severity.data}>
          {severityLabel(severity.data)}
        </StatusMark>
      ) : null}
    </Inline>
  );
}

export function SeoPanel({
  fields,
  fetch,
}: Readonly<{ fields: AgentRevision['fields']; fetch: AgentPageFetchDone | null }>) {
  const failing = fetch?.checks.filter((check) => check.failing) ?? [];
  const passed = (fetch?.checks.length ?? 0) - failing.length;
  return (
    <Stack gap="workspace">
      <Stack as="section" gap="compact" aria-labelledby="seo-fields">
        <h3 id="seo-fields" className={textRole('subheading')}>
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
          <p className={textRole('body', 'text-ink-2')}>This revision has no SEO fields.</p>
        )}
      </Stack>
      <Stack as="section" gap="compact" aria-labelledby="seo-checks">
        <h3 id="seo-checks" className={textRole('subheading')}>
          Page checks
        </h3>
        <p className={textRole('caption')}>
          {fetch?.fetched_at ? (
            <>
              Fetched <DisplayTime value={fetch.fetched_at} />.{' '}
            </>
          ) : null}
          Editing the page doesn’t rerun them.
        </p>
        {failing.length > 0 ? (
          <ul aria-label="Checks to fix" className={ledgerClasses()}>
            {failing.map((check) => (
              <CheckRow key={check.rule_id} check={check} />
            ))}
          </ul>
        ) : (
          <p className={textRole('body', 'text-ink-2')}>
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
