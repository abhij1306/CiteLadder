import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';
import type { ActionDetail } from '@/lib/api/actions';
import { pluralCount, readableUrl } from '@/lib/format';

/** How many cohort pages the section lists before "Show all". */
const COHORT_PAGES_SHOWN = 20;
const HEADING_ID = 'action-affected-pages';

/**
 * An issue family's cohort: the rule, the crawl it was read from (the
 * declared one once declared) and the pages it fails on. The server lists at
 * most a bounded number; a larger count says how many it left out.
 */
export function AffectedPages({ action }: Readonly<{ action: ActionDetail }>) {
  const [all, setAll] = useState(false);
  const { cohort } = action;
  if (!cohort) return null;
  const shown = all ? cohort.pages : cohort.pages.slice(0, COHORT_PAGES_SHOWN);
  const unlisted = cohort.page_count - cohort.pages.length;
  return (
    <Stack as="section" aria-labelledby={HEADING_ID}>
      <EditorialSectionHeader title="Affected pages" headingId={HEADING_ID} />
      <p className={textRole('body')}>
        {cohort.rule_label} fails on {pluralCount(cohort.page_count, 'page')}
        {cohort.crawl_completed_at ? (
          <>
            {' '}
            in the crawl completed <DisplayTime value={cohort.crawl_completed_at} dateOnly />
          </>
        ) : (
          ' in a crawl that is no longer stored'
        )}
        .
      </p>
      <Card>
        <CardContent>
          <ul className={ledgerClasses()} aria-label="Affected pages">
            {shown.map((page) => (
              <li key={page.site_url_id} className={ledgerItemClasses()}>
                <TextLink variant="external" href={page.url} text="body" className="break-all">
                  {readableUrl(page.url)}
                </TextLink>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {cohort.pages.length > COHORT_PAGES_SHOWN ? (
        <Button variant="secondary" className="justify-self-start" onClick={() => setAll(!all)}>
          {all ? 'Show fewer pages' : `Show all ${cohort.pages.length} listed pages`}
        </Button>
      ) : null}
      {unlisted > 0 ? (
        <p className={textRole('caption')}>
          {pluralCount(unlisted, 'more page')} share this issue and are not listed.
        </p>
      ) : null}
    </Stack>
  );
}
