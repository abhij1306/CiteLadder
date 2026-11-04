import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { type AgentWebSource } from '@/lib/api/agent';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';

/**
 * Pages a web search returned, kept apart from the CiteLadder records a reply
 * cites: they are outside observations, not project data.
 */
export function WebSources({
  sources,
  label = 'Web sources',
}: Readonly<{ sources: readonly AgentWebSource[]; label?: string }>) {
  if (sources.length === 0) return null;
  return (
    <Stack as="section" gap="tight" aria-label={label}>
      <span className={textRole('label')}>{label}</span>
      <Stack as="ul" gap="tight">
        {sources.map((source) => (
          <li key={source.url} className="min-w-0">
            <TextLink variant="external" href={source.url} text="caption" className="truncate">
              {source.title.trim() || hostOf(source.url)}
            </TextLink>
            <span className={textRole('caption')}> · {hostOf(source.url)}</span>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

function hostOf(url: string): string {
  return parseAbsoluteHttpUrl(url)?.hostname ?? url;
}
