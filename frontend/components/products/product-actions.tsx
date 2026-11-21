import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { ActionButton } from '@/components/ui/actions';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';

const PAGE_WORKFLOW = 'optimize_page';

export function ProductActions({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  const { actions, product } = detail;
  return (
    <Section>
      <SectionHeader
        actions={
          product.url ? (
            <ActionButton
              action="workWithAgent"
              href={agentHandoffHref({ targetUrl: product.url, workflowId: PAGE_WORKFLOW })}
            />
          ) : null
        }
      >
        <SectionTitle level={3}>Actions</SectionTitle>
      </SectionHeader>
      <SectionContent>
        {actions.length ? (
          <LedgerList>
            {actions.map((action) => (
              <LedgerItem
                key={action.id}
                title={
                  <TextLink href={`/actions/${action.id}`} text="inherit">
                    {action.title}
                  </TextLink>
                }
                meta={<ActionStatusBadge status={action.status} />}
                links={
                  <ActionButton
                    action="workWithAgent"
                    href={agentHandoffHref({ actionId: action.id })}
                    aria-label={`Work with the agent on ${action.title}`}
                  />
                }
              />
            ))}
          </LedgerList>
        ) : (
          <p className={textRole('body', 'text-ink-2')}>No open Actions for this product.</p>
        )}
      </SectionContent>
    </Section>
  );
}
