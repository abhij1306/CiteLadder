'use client';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import { PROMPTS_GENERATE_HREF, PROMPTS_HREF } from '@/lib/prompts/routes';

/**
 * Shown on Overview while the project tracks no active prompts. Onboarding
 * creates none, so this is where a new project starts: the user chooses what
 * to measure before any visibility number exists.
 */
export function PromptSetupCard() {
  return (
    <Card tone="recommendation" aria-labelledby="prompt-setup-heading">
      <CardHeader>
        <CardTitle id="prompt-setup-heading">Choose the questions you want to track</CardTitle>
        <p className={textRole('caption')}>
          Generate buyer questions from your confirmed offerings, or add your own.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="md">
          <ProjectLink href={PROMPTS_GENERATE_HREF}>Generate prompts</ProjectLink>
        </Button>
        <Button asChild variant="secondary" size="md">
          <ProjectLink href={PROMPTS_HREF}>Add or import prompts</ProjectLink>
        </Button>
      </CardContent>
    </Card>
  );
}
