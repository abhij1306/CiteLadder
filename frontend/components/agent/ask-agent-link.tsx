import type { ReactNode } from 'react';

import { ActionButton } from '@/components/ui/actions';
import { TextLink } from '@/components/ui/text-link';
import { agentHandoffHref, type HandoffInput } from '@/lib/agent/handoff';

export function AskAgentLink({
  handoff,
  ...props
}: Readonly<
  { handoff: HandoffInput } & (
    | {
        appearance?: 'button';
        'aria-label'?: string;
      }
    | {
        appearance: 'text';
        children: ReactNode;
      }
  )
>) {
  const href = agentHandoffHref(handoff);
  if (props.appearance === 'text')
    return (
      <TextLink text="caption" className="w-fit" href={href}>
        {props.children}
      </TextLink>
    );
  return <ActionButton action="askAgent" href={href} aria-label={props['aria-label']} />;
}
