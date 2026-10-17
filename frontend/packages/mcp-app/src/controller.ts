import { z } from 'zod';
import {
  analyticsResultSchema,
  analyticsSelectionSchema,
  type AnalyticsResult,
  type AnalyticsSelection,
} from '@citeladder/contracts/mcp-app';
import { appPolicy } from './config';

export type Host = {
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  context: (
    selection: AnalyticsSelection | null,
    evidence?: Record<string, unknown>,
  ) => Promise<unknown>;
};
const projectsSchema = z.object({
  projects: z.array(z.object({ id: z.uuid(), name: z.string(), workspace_name: z.string() })),
  pagination: z.object({ next_cursor: z.string().nullable() }),
});
const findingsSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), items: z.array(z.record(z.string(), z.json())) }),
  z.object({ state: z.literal('unavailable'), reason: z.string() }),
]);
/**
 * A result as displayed. The server supplies the application links; before any
 * server result has arrived there is none, and the links are hidden rather
 * than guessed.
 */
export type AppResult = Omit<AnalyticsResult, 'links'> & { links: AnalyticsResult['links'] | null };
export type AppState = {
  result: AppResult | null;
  selection: AnalyticsSelection | null;
  projects: z.infer<typeof projectsSchema>['projects'];
  projectCursor: string | null;
  busy: boolean;
  error: string | null;
  answers: Record<string, unknown>[];
};

class ResultSizeError extends Error {
  constructor() {
    super('Result exceeds the display limit');
    this.name = 'ResultSizeError';
  }
}
function bounded(value: unknown): unknown {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > appPolicy.maxResultBytes)
    throw new ResultSizeError();
  return value;
}
function evidence(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.json()).parse(bounded(value));
}

async function readSelection(host: Host, input: AnalyticsSelection) {
  const selection = { ...input };
  const base = {
    project_id: selection.project_id,
    engine: selection.engine,
    cohort: selection.cohort,
  };
  let data: Record<string, unknown>;
  if (selection.view === 'trends') {
    data = evidence(
      await host.call('read_visibility_trends', {
        ...base,
        from_at: selection.from_at,
        to_at: selection.to_at,
        transport_model: selection.transport_model,
        retrieval_enabled: selection.retrieval_enabled,
      }),
    );
  } else if (selection.view === 'site_health') {
    data = evidence(
      await host.call('read_site_health', {
        project_id: selection.project_id,
        snapshot_id: selection.snapshot_id,
      }),
    );
    if (typeof data.snapshot_id === 'string') selection.snapshot_id = data.snapshot_id;
  } else {
    data = evidence(
      await host.call('read_visibility_overview', { ...base, audit_id: selection.audit_id }),
    );
    if (typeof data.audit_id === 'string') selection.audit_id = data.audit_id;
    if (selection.view === 'sources' && selection.audit_id) {
      data = evidence(
        await host.call('read_visibility_sources', {
          ...base,
          audit_id: selection.audit_id,
          level: selection.level,
          domain: selection.domain,
          cursor: selection.cursor,
          limit: selection.limit,
        }),
      );
    }
  }
  return { selection, data };
}

/** One generation per selection. Late reads can never repopulate old scope. */
export function createController(host: Host) {
  let generation = 0;
  let projectRequest = 0;
  // Initial hosts may send only a result. Subsequent results must belong to
  // a tool-input generation, never to a local selection or disconnected view.
  let hostGeneration: number | null = 0;
  let requestedSelection: Partial<AnalyticsSelection> | null = null;
  // The application links of the last server result; survives a failed read.
  let serverLinks: AnalyticsResult['links'] | null = null;
  let state: AppState = {
    result: null,
    selection: null,
    projects: [],
    projectCursor: null,
    busy: false,
    error: null,
    answers: [],
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  let contextQueue: Promise<unknown> = Promise.resolve();
  const context = (selection: AnalyticsSelection | null, epoch: number) => {
    contextQueue = contextQueue
      .catch(() => undefined)
      .then(() => {
        if (epoch === generation)
          return host.context(selection, selection ? state.result?.evidence : undefined);
      })
      .catch(() => undefined);
  };
  const failHostRead = (error?: unknown) => {
    if (hostGeneration !== generation) return;
    hostGeneration = null;
    ++generation;
    set({
      result: null,
      answers: [],
      busy: false,
      error:
        error instanceof ResultSizeError
          ? 'Evidence exceeds the display limit. Narrow the selection in CiteLadder and retry.'
          : 'Evidence is unavailable. Retry or check the connection and access.',
    });
    context(null, generation);
  };
  const receive = (value: unknown) => {
    if (hostGeneration !== generation) return;
    let result: AnalyticsResult;
    try {
      result = analyticsResultSchema.parse(bounded(value));
      const resolved = result.selection;
      if (requestedSelection) {
        if (!resolved) throw new Error('Missing requested selection');
        const matches = Object.entries(requestedSelection).every(([key, expected]) => {
          // Latest resolves to concrete IDs. All other filters retain their scope.
          if ((key === 'audit_id' || key === 'snapshot_id') && expected == null) return true;
          return (resolved[key as keyof AnalyticsSelection] ?? null) === (expected ?? null);
        });
        if (!matches) throw new Error('Result does not match requested selection');
      }
    } catch (error) {
      failHostRead(error);
      return;
    }
    hostGeneration = null;
    const epoch = ++generation;
    serverLinks = result.links;
    set({
      result,
      selection: result.selection,
      busy: false,
      error: null,
      answers: [],
    });
    context(result.selection, epoch);
  };
  const select = async (input: unknown) => {
    const epoch = ++generation;
    const selection = analyticsSelectionSchema.parse(input);
    const links = state.result?.links ?? serverLinks;
    set({ result: null, selection, answers: [], busy: true, error: null });
    context(null, epoch);
    try {
      const { selection: resolved, data } = await readSelection(host, selection);
      if (epoch !== generation) return;
      let resolvedLinks: AnalyticsResult['links'] | null = null;
      if (links) {
        const application = new URL(
          resolved.view === 'site_health' ? '/site' : '/visibility',
          links.application,
        );
        application.searchParams.set('project', resolved.project_id);
        resolvedLinks = { ...links, application: application.href };
      }
      set({
        result: {
          ...analyticsResultSchema.omit({ links: true }).parse({
            surface: 'citeladder_analytics',
            selection: resolved,
            evidence: data,
          }),
          links: resolvedLinks && analyticsResultSchema.shape.links.parse(resolvedLinks),
        },
        selection: resolved,
        busy: false,
      });
      context(resolved, epoch);
    } catch {
      if (epoch === generation)
        set({
          busy: false,
          error: 'Evidence is unavailable. Check the connection and access, then retry.',
        });
    }
  };
  const loadProjects = async (cursor: string | null = null) => {
    const epoch = generation;
    const request = ++projectRequest;
    try {
      const page = projectsSchema.parse(
        bounded(await host.call('list_projects', { limit: appPolicy.pageSize, cursor })),
      );
      if (epoch !== generation || request !== projectRequest) return;
      set({
        projects: cursor ? [...state.projects, ...page.projects] : page.projects,
        projectCursor: page.pagination.next_cursor,
        error: null,
      });
    } catch {
      if (epoch !== generation || request !== projectRequest) return;
      ++generation;
      set({
        result: null,
        projects: [],
        projectCursor: null,
        answers: [],
        busy: false,
        error: 'Connect your CiteLadder account or reconnect to restore access.',
      });
      context(null, generation);
    }
  };
  const drill = async (source: string) => {
    const selection = state.selection;
    if (!selection?.audit_id) return;
    const epoch = ++generation;
    set({ answers: [], busy: true, error: null });
    try {
      const data = evidence(
        await host.call('read_visibility_results', {
          project_id: selection.project_id,
          audit_id: selection.audit_id,
          engine: selection.engine,
          cohort: selection.cohort,
          [selection.level === 'url' ? 'url' : 'domain']: source,
          limit: appPolicy.pageSize,
        }),
      );
      if (epoch === generation)
        set({ busy: false, answers: Array.isArray(data.items) ? data.items.map(evidence) : [] });
    } catch {
      if (epoch === generation) {
        set({
          result: null,
          busy: false,
          error: 'Source evidence is unavailable. Retry or reconnect.',
        });
        context(null, epoch);
      }
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receive,
    failHostRead,
    selectCompetitor: (competitor: string | null) => {
      if (!state.selection || !state.result) return;
      if (state.selection.view !== 'overview' && state.selection.view !== 'trends') return;
      const selection = analyticsSelectionSchema.parse({ ...state.selection, competitor });
      const epoch = ++generation;
      set({ selection, result: { ...state.result, selection } });
      context(selection, epoch);
    },
    select,
    loadProjects,
    drill,
    begin: (input: unknown, toolName?: string) => {
      const args = z.record(z.string(), z.unknown()).safeParse(input);
      const parsed = analyticsSelectionSchema.safeParse(
        toolName === 'render_site_health' && args.success
          ? { ...args.data, view: 'site_health' }
          : input,
      );
      hostGeneration = ++generation;
      requestedSelection = parsed.success ? parsed.data : null;
      if (parsed.success && !toolName && args.success && args.data.view === undefined) {
        // toolInfo is optional. Project-only arguments are shared by Overview
        // and Site Health; the authenticated result determines the actual view.
        const { view: _view, ...selection } = parsed.data;
        requestedSelection = selection;
      }
      set({
        result: null,
        answers: [],
        selection: parsed.success ? parsed.data : null,
        busy: true,
        error: null,
      });
      context(null, generation);
    },
    fetchAnswer: async (id: string) => {
      if (!/^citeladder:\/\/visibility_result\/[0-9a-f-]{36}$/u.test(id)) return;
      const epoch = generation;
      try {
        const data = evidence(await host.call('fetch', { id }));
        if (epoch !== generation) return;
        set({
          answers: state.answers.map((answer) =>
            answer.record_uri === id ? { ...answer, answer_text: data.text } : answer,
          ),
        });
      } catch {
        if (epoch !== generation) return;
        ++generation;
        set({
          result: null,
          answers: [],
          busy: false,
          error: 'Answer evidence is unavailable. Retry or reconnect.',
        });
        context(null, generation);
      }
    },
    siteFindings: async () => {
      const epoch = generation;
      const selected = state.selection;
      if (!selected) return null;
      let result: z.infer<typeof findingsSchema>;
      try {
        result = findingsSchema.parse(
          bounded(
            await host.call('read_actions', {
              project_id: selected.project_id,
              limit: appPolicy.pageSize,
            }),
          ),
        );
      } catch (error) {
        if (epoch === generation) {
          ++generation;
          set({
            result: null,
            answers: [],
            busy: false,
            error: 'Actions are unavailable. Retry or reconnect.',
          });
          context(null, generation);
        }
        throw error;
      }
      return epoch === generation ? result : null;
    },
    sitePages: async () => {
      const epoch = generation;
      const selected = state.selection;
      const crawlId = state.result?.evidence.crawl_id;
      if (!selected || typeof crawlId !== 'string') return [];
      let result: Record<string, unknown>;
      try {
        result = evidence(
          await host.call('read_site_pages', {
            project_id: selected.project_id,
            crawl_id: crawlId,
            limit: appPolicy.pageSize,
          }),
        );
      } catch (error) {
        if (epoch === generation) {
          ++generation;
          set({
            result: null,
            answers: [],
            busy: false,
            error: 'Page evidence is unavailable. Retry or reconnect.',
          });
          context(null, generation);
        }
        throw error;
      }
      if (epoch !== generation) return [];
      return Array.isArray(result.items) ? result.items.map(evidence) : [];
    },
    disconnect: () => {
      ++generation;
      set({
        result: null,
        projects: [],
        projectCursor: null,
        answers: [],
        busy: false,
        error: 'Connect your CiteLadder account to read evidence.',
      });
      context(null, generation);
    },
  };
}
export type Controller = ReturnType<typeof createController>;
