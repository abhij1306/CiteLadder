import type { z } from 'zod';

import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
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
  unreadReason,
} from '@/lib/visibility/source-pages';
import { pageFormatBasis, urlTypeLabel } from '@/lib/visibility/vocabulary';
import { SectionContent, TitledSection } from '@/components/ui/section';

type Page = z.infer<typeof visibilitySourceUrlSchema>['page'];

export function SourceUrlPageCard({
  url,
  page,
  loading,
}: Readonly<{ url: string; page: Page | undefined; loading: boolean }>) {
  if (loading) return <Skeleton variant="facts" />;
  if (page === undefined) return null;
  const standing = page?.standing ?? 'untracked';
  if (standing === 'competitor') return null;
  const brand = brandVerdict(page?.entities);
  return (
    <TitledSection title="On this page" description={unreadReason(standing)}>
      <SectionContent>
        <Stack gap="workspace">
          {standing === 'gap' ? <GetListed url={url} actionId={page?.action_id ?? null} /> : null}
          <OnPageEntities
            heading={standing === 'gap' ? 'Listed here' : 'Competitors on this page'}
            entities={onPageCompetitors(page?.entities)}
          />
          {brand && page?.read_at ? (
            <BrandOnPage
              heading="You"
              brand={brand}
              extractedChars={page.extracted_chars ?? null}
            />
          ) : null}
          {page ? <PageFacts page={page} /> : null}
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

function GetListed({ url, actionId }: Readonly<{ url: string; actionId: string | null }>) {
  return (
    <Inline className="flex-wrap">
      {actionId ? (
        <>
          <Button variant="primary" asChild>
            <ProjectLink href={`/actions/${actionId}`}>Open the Action</ProjectLink>
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
