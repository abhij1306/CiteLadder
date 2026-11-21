import { ClampText } from '@/components/ui/clamp-text';
import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { type AgentWebSource } from '@/lib/api/agent';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';

export function WebSources({ sources }: Readonly<{ sources: readonly AgentWebSource[] }>) {
  if (sources.length === 0) return null;
  return (
    <Stack as="section" gap="tight" aria-label="Web sources">
      <span className={textRole('body', 'text-ink-2')}>Web sources</span>
      <Stack as="ul" gap="tight">
        {sources.map((source) => (
          <li key={source.url} className="min-w-0">
            <ClampText className={textRole('caption')}>
              <TextLink variant="external" href={source.url} text="caption">
                {source.title.trim() || hostOf(source.url)}
              </TextLink>{' '}
              · {hostOf(source.url)}
            </ClampText>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

function hostOf(url: string): string {
  return parseAbsoluteHttpUrl(url)?.hostname ?? url;
}
