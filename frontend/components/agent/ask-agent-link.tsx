import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { TextLink } from '@/components/ui/text-link';
import { agentHandoffHref, type HandoffInput } from '@/lib/agent/handoff';

/**
 * "Ask agent" from a Dashboard screen: a new Agent chat started from the
 * screen's typed references (ids, a prompt, a skill), never its evidence. The
 * one place such a question leaves a screen, so where it opens is decided
 * here for every caller.
 */
export function AskAgentLink({
  handoff,
  appearance = 'button',
  children = 'Ask agent',
}: Readonly<{
  handoff: HandoffInput;
  /** A button among a record's actions, or a caption link under one row. */
  appearance?: 'button' | 'primary' | 'text';
  children?: ReactNode;
}>) {
  const href = agentHandoffHref(handoff);
  if (appearance === 'text')
    return (
      <TextLink text="caption" className="w-fit" href={href}>
        {children}
      </TextLink>
    );
  return (
    <Button asChild variant={appearance === 'primary' ? 'primary' : 'secondary'}>
      <ProjectLink href={href}>{children}</ProjectLink>
    </Button>
  );
}
