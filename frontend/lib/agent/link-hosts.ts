import { useMemo } from 'react';

import type { AgentWebSource } from '@/lib/api/agent';
import { linkHost } from '@/lib/markdown/safe-url';
import { useOptionalProjectContext } from '@/lib/project/project-scope';

/**
 * Hosts an Agent reply or document may link to directly: the active project's
 * own site and owned domains, the web sources that turn cited, and the app
 * itself. Any other link asks before it opens (see `ContentMarkdown`).
 */
const NO_SOURCES: readonly AgentWebSource[] = [];

export function useAgentLinkHosts(
  sources: readonly AgentWebSource[] = NO_SOURCES,
): readonly string[] {
  const project = useOptionalProjectContext()?.activeProject ?? null;
  return useMemo(() => {
    const candidates = [
      globalThis.location?.hostname ?? '',
      project?.website_url ?? '',
      ...(project?.owned_domains ?? []),
      ...sources.map((source) => source.url),
    ];
    return [...new Set(candidates.flatMap((value) => linkHost(value) ?? []))];
  }, [project, sources]);
}
