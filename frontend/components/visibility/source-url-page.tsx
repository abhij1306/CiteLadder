'use client';

import type { z } from 'zod';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { OnPageEntities } from '@/components/ui/on-page-entities';
import { Skeleton } from '@/components/ui/skeleton';
import { BrandOnPage } from '@/components/visibility/brand-on-page';
import type { visibilitySourceUrlSchema } from '@citeladder/contracts/visibility-evidence';
import { agentHandoffHref } from '@/lib/agent/handoff';
import {
  brandVerdict,
  onPageCompetitors,
  readingSentence,
  standingSentence,
} from '@/lib/visibility/source-pages';
import { pageFormatBasis, urlTypeLabel } from '@/lib/visibility/vocabulary';

type Page = z.infer<typeof visibilitySourceUrlSchema>['page'];

/**
 * What the business can do about one cited page, and what the page says.
 *
 * It leads with where the business stands — listed, absent beside listed
 * competitors, or not judged yet and why — because that decides whether
 * there is anything to do. Every name shown as on the page carries the line
 * that proves it; a page nobody read shows no verdicts at all.
 */
export function SourceUrlPageCard({
  url,
  page,
  loading,
}: Readonly<{ url: string; page: Page | undefined; loading: boolean }>) {
  if (loading) return <Skeleton shape="block" />;
  if (page === undefined) return null;
  const standing = page?.standing ?? 'untracked';
  const brand = brandVerdict(page?.entities);
  return (
    <Card>
      <CardHeader>
        <CardTitle>On this page</CardTitle>
        <CardDescription>{standingSentence(standing)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="workspace">
          {standing === 'gap' ? <GetListed url={url} actionId={page?.action_id ?? null} /> : null}
          <OnPageEntities
            heading={standing === 'gap' ? 'Listed here' : 'Competitors on this page'}
            entities={onPageCompetitors(page?.entities)}
          />
          {brand && page?.read_at ? (
            <BrandOnPage heading="You" brand={brand} extractedChars={page.extracted_chars ?? 0} />
          ) : null}
          {page ? <PageFacts page={page} /> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * The two ways to act on the gap. An open Action carries the brief and the
 * measurement; before one exists (the page is not yet cited often enough),
 * the Agent can still draft the request from the page itself.
 */
function GetListed({ url, actionId }: Readonly<{ url: string; actionId: string | null }>) {
  return (
    <Inline className="flex-wrap">
      {actionId ? (
        <>
          <Button asChild>
            <ProjectLink href={`/agent/actions/${actionId}`}>Open the Action</ProjectLink>
          </Button>
          <Button variant="secondary" asChild>
            <ProjectLink href={agentHandoffHref({ actionId })}>Draft the request</ProjectLink>
          </Button>
        </>
      ) : (
        <Button variant="secondary" asChild>
          <ProjectLink
            href={agentHandoffHref({
              targetUrl: url,
              skillId: 'earned_authority',
              prompt: 'Draft a request to be listed on this page alongside the competitors on it.',
            })}
          >
            Draft a request to be listed
          </ProjectLink>
        </Button>
      )}
    </Inline>
  );
}

function pageTypeFact(
  type: string | null | undefined,
  page: NonNullable<Page>,
  basis: string | null | undefined,
): string {
  if (!type || page.page_format === 'unresolved') {
    return 'What kind of page this is could not be established.';
  }
  const basisNote = basis ? ` (${basis.charAt(0).toLowerCase()}${basis.slice(1)})` : '';
  return `Page type: ${type}${basisNote}.`;
}

/** When it was read, how much of it, and what kind of page it is by what evidence. */
function PageFacts({ page }: Readonly<{ page: NonNullable<Page> }>) {
  const type = urlTypeLabel(page.page_format);
  const basis = pageFormatBasis(page.page_format_method);
  const facts = [
    readingSentence(page.read_at, page.extracted_chars),
    pageTypeFact(type, page, basis),
  ].filter(Boolean);
  return (
    <Stack gap="tight">
      {facts.map((fact) => (
        <p key={fact} className="type-caption">
          {fact}
        </p>
      ))}
    </Stack>
  );
}
