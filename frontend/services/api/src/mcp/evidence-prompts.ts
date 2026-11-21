import { policy } from '../config.ts';
import { parseUuid } from '../http/uuid.ts';
import { getVisibilityFanout } from '../visibility/fanout.ts';
import { getPromptAnswers } from '../visibility/prompt-answers.ts';
import { getPromptHistory } from '../visibility/prompt-history.ts';
import { getPromptMetrics } from '../visibility/prompts.ts';
import { latestBrandRunId } from '../visibility/selection.ts';
import { mcpPolicy } from './config.ts';
import { decodeCursor, encodeCursor, pagination, reference, unavailable } from './data.ts';
import { notYetMeasured, oneRun, type Page, type Selection } from './evidence-analytics.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type PromptMetricsArgs = Selection &
  Page & {
    view: 'list' | 'history' | 'answers';
    prompt_id?: string | null;
    baseline_id?: string | null;
  };

const resultUri = (taskId: string) => `citeladder://visibility_result/${taskId}`;

function listStart(args: PromptMetricsArgs): { auditId: string | null; offset: number } {
  if (!args.cursor) return { auditId: args.audit_id ?? null, offset: 0 };
  const [run, at] = decodeCursor(args.cursor, 2);
  const offset = Number(at);
  if (parseUuid(run) === null || !Number.isSafeInteger(offset) || offset < 0)
    throw new McpInputError('cursor is invalid');
  if (args.audit_id && run !== args.audit_id)
    throw new McpInputError('cursor belongs to another run');
  return { auditId: run ?? null, offset };
}

async function promptList(read: ProjectRead, args: PromptMetricsArgs): Promise<Evidence> {
  const scope = { ...read.scope, marketId: args.market_id ?? null };
  const { auditId, offset } = listStart(args);
  let items: Awaited<ReturnType<typeof getPromptMetrics>>;
  try {
    items = await getPromptMetrics(read.db, scope, {
      auditId,
      auditIds: null,
      baselineAuditIds: null,
      baselineId: args.baseline_id ?? null,
      logicalEngine: args.engine ?? null,
      cohort: args.cohort,
    });
  } catch (error) {
    return notYetMeasured(error, Boolean(auditId || args.baseline_id));
  }
  const runId = auditId ?? items[0]?.audit_id ?? (await latestBrandRunId(read.db, scope));
  if (runId === null) return unavailable('no_completed_run');
  return listPage({ runId, items, offset, limit: args.limit ?? mcpPolicy.default_list_limit });
}

function listPage(input: {
  runId: string;
  items: Awaited<ReturnType<typeof getPromptMetrics>>;
  offset: number;
  limit: number;
}): Evidence {
  const { runId, items, offset } = input;
  const end = offset + input.limit;
  const page = items.slice(offset, end).map((item) => ({
    ...item,
    record_uri: item.prompt_id ? `citeladder://prompt/${item.prompt_id}` : null,
  }));
  return {
    state: 'available',
    view: 'list',
    audit_id: runId,
    items: page,
    pagination: pagination(
      page,
      end < items.length ? encodeCursor(runId, end) : null,
      items.length,
    ),
    artifact_refs: items.length ? [reference('audit', runId)] : [],
  };
}

export async function promptMetricsRead(
  read: ProjectRead,
  args: PromptMetricsArgs,
): Promise<Evidence> {
  if (args.view === 'list') return promptList(read, args);
  const promptId = args.prompt_id;
  if (!promptId) throw new McpInputError(`view ${args.view} needs prompt_id`);
  const scope = { ...read.scope, marketId: args.market_id ?? null };
  const engine = args.engine ?? null;
  if (args.view === 'history') {
    const history = await getPromptHistory(read.db, scope, {
      promptId,
      logicalEngine: engine,
      cohort: null,
    });
    return {
      state: 'available',
      view: 'history',
      ...history,
      artifact_refs: [reference('prompt', promptId)],
    };
  }
  const page = await getPromptAnswers(read.db, scope, {
    promptId,
    logicalEngine: engine,
    fromAt: null,
    toAt: null,
    brand: null,
    cited: null,
    search: null,
    cursor: args.cursor ?? null,
    limit: Math.min(
      args.limit ?? policy.visibility.prompt_answers_page_size,
      policy.visibility.prompt_answers_max_limit,
    ),
  });
  const items = page.items.map((item) => ({ ...item, record_uri: resultUri(item.execution_id) }));
  return {
    state: 'available',
    view: 'answers',
    market_id: page.market_id,
    items,
    pagination: pagination(items, page.next_cursor),
    artifact_refs: items.map((item) => reference('visibility_result', item.execution_id)),
  };
}

export async function queryFanoutsRead(
  read: ProjectRead,
  args: Selection &
    Page & {
      prompt_id?: string | null;
      search?: string | null;
      order: 'top' | 'rising' | 'falling';
    },
): Promise<Evidence> {
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const auditId = run.selection.auditId;
  try {
    const summary = await getVisibilityFanout(read.db, run.selection, {
      query: null,
      search: args.search ?? null,
      order: args.order,
      cursor: args.cursor ?? null,
      limit: Math.min(
        args.limit ?? mcpPolicy.default_list_limit,
        policy.visibility.evidence_max_limit,
      ),
      filters: {
        outcome: null,
        competitor: null,
        domain: null,
        url: null,
        promptId: args.prompt_id ?? null,
      },
    });
    const { answers: _answers, next_cursor, ...rest } = summary;
    return {
      state: 'available',
      audit_id: auditId,
      ...rest,
      pagination: pagination(summary.items, next_cursor, summary.matched_queries),
      artifact_refs: auditId ? [reference('audit', auditId)] : [],
    };
  } catch (error) {
    return notYetMeasured(error, Boolean(args.audit_id));
  }
}
