import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Inline } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { Button } from '@/components/ui/button';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { agentHandoffHref } from '@/lib/agent/handoff';

/** The workflow that fetches a page into a page document and opens its workspace. */
const PAGE_WORKFLOW = 'optimize_page';

/**
 * The open Actions against one catalog product, each with its way into the
 * Agent, and the Agent on the product's own page when no Action names it yet.
 * Commerce Actions come from measured answers, so a new one appears here
 * after the next audit, not from a button.
 */
export function ProductActions({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  const { actions, product } = detail;
  return (
    <Card>
      <CardHeader
        actions={
          product.url ? (
            <Button asChild variant="secondary">
              <ProjectLink
                href={agentHandoffHref({ targetUrl: product.url, workflowId: PAGE_WORKFLOW })}
              >
                Work with the agent
              </ProjectLink>
            </Button>
          ) : null
        }
      >
        <CardTitle>Actions</CardTitle>
        <CardDescription>Open work that can raise its visibility in AI answers.</CardDescription>
      </CardHeader>
      <CardContent>
        {actions.length ? (
          <ul className={ledgerClasses()}>
            {actions.map((action) => (
              <Inline
                as="li"
                key={action.id}
                gap="compact"
                className={ledgerItemClasses('flex-wrap')}
              >
                <TextLink
                  href={`/agent/actions/${action.id}`}
                  text="inherit"
                  className={textRole('emphasis', 'min-w-0 flex-1')}
                >
                  {action.title}
                </TextLink>
                <ActionStatusBadge status={action.status} />
                <Button asChild variant="ghost">
                  <ProjectLink href={agentHandoffHref({ actionId: action.id })}>
                    Work with the agent
                  </ProjectLink>
                </Button>
              </Inline>
            ))}
          </ul>
        ) : (
          <p className={textRole('body')}>
            No open Actions for this product. Audits that measure it open Actions when its answers
            show something to fix.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
