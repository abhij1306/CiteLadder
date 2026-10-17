/**
 * Live Agent eval: drives fixed chats through the local Agent API as the
 * local user and records, per turn, the time to the first visible text,
 * the total time, model and tool calls, tokens (cached included) and the saved
 * reply and document. Operator-run only (it calls the configured model and
 * spends provider budget); never part of CI. Turns go through the HTTP API and
 * are measured from the attempt rows, so the same cases measure any runtime
 * that keeps them; project rows only resolve the cases' placeholders and
 * Actions.
 *
 *   pnpm --filter @citeladder/api agent:eval --live --label baseline
 *   pnpm --filter @citeladder/api agent:eval --report baseline,native
 *
 * Records append to `agent-eval/<label>.jsonl` in the worktree's Git directory;
 * `--report` prints a metrics table and writes a side-by-side reply review.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

import { agentChatDetailSchema, agentTurnAcceptedSchema } from '@citeladder/contracts/agent';
import { localEnvironment } from '../src/cli/local-environment.ts';
import { requireLocalDevelopment } from '../src/cli/operator.ts';
import { LOCAL_USER_EMAIL } from '../src/auth/local.ts';
import { loadConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/database.ts';
import { stripTrailing } from '../src/text-order.ts';
import { gitDirectory } from './git-directory.ts';
import raw from '../test/fixtures/agent/eval-cases.json' with { type: 'json' };

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    label: { type: 'string' },
    case: { type: 'string' },
    project: { type: 'string' },
    api: { type: 'string', default: 'http://127.0.0.1:8100/api/v1' },
    report: { type: 'string' },
  },
});

const PLACEHOLDERS = ['brand', 'top_prompt', 'competitor'] as const;
type Placeholders = Record<(typeof PLACEHOLDERS)[number], string>;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

const turnSchema = z.strictObject({
  message: z
    .string()
    .refine(
      (message) =>
        [...message.matchAll(PLACEHOLDER)].every(([, key]) =>
          (PLACEHOLDERS as readonly string[]).includes(key!),
        ),
      'Unknown {{placeholder}}',
    ),
  skill_id: z.string().optional(),
  action: z.strictObject({ skill_id: z.string(), target_kind: z.string().optional() }).optional(),
});
type TurnSpec = z.infer<typeof turnSchema>;
// Parsed at start, so a typo in a case fails before any provider spend.
const cases = z
  .array(
    z.strictObject({
      id: z.string(),
      kind: z.string(),
      turns: z.array(turnSchema).min(1),
      review: z.string(),
    }),
  )
  .parse(raw);

const recordSchema = z.looseObject({
  case: z.string(),
  step: z.number(),
  failed: z.string().optional(),
  run_status: z.string().nullish(),
  run_error: z.string().nullish(),
  first_text_ms: z.number().nullish(),
  total_ms: z.number().nullish(),
  model_calls: z.number().optional(),
  tool_calls: z.number().optional(),
  input_tokens: z.number().nullish(),
  cached_input_tokens: z.number().nullish(),
  cache_write_input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  message: z.string().optional(),
  reply: z.string().nullish(),
  output: z.looseObject({ phase: z.string(), title: z.string(), body: z.string() }).nullish(),
});
type EvalRecord = z.infer<typeof recordSchema>;
// Event shapes differ between runtimes; only the type tag is required.
const eventSchema = z.looseObject({ type: z.string() });

const directory = join(gitDirectory(process.cwd()), 'agent-eval');

/** Labels name files in the eval directory, so they stay plain file names. */
function labelFile(label: string, extension: string) {
  if (!/^[\w-]+$/.test(label))
    throw new Error(`Label "${label}" may use only letters, digits, - and _`);
  return join(directory, `${label}${extension}`);
}

async function live() {
  if (!values.live)
    throw new Error('The Agent eval calls the configured model provider; pass --live to run it');
  if (!values.label) throw new Error('Name the run with --label');
  const label = values.label;
  const log = labelFile(label, '.jsonl');
  const api = localApi(values.api);
  const env = localEnvironment();
  const config = loadConfig(env);
  requireLocalDevelopment(config);
  const db = createDatabase(config);
  try {
    const project = await resolveProject(db, LOCAL_USER_EMAIL, values.project);
    const vars = await placeholders(db, project.id);
    const client: Client = { api, headers: { 'X-Workspace-Id': project.workspaceId } };
    await mkdir(directory, { recursive: true });
    const write = (record: object) => appendFile(log, `${JSON.stringify({ label, ...record })}\n`);
    const context: CaseContext = { db, client, project, vars, write };
    for (const item of cases) {
      if (!values.case || item.id.startsWith(values.case)) await runCase(context, item);
    }
    console.log(`Recorded ${log}`);
  } finally {
    await db.destroy();
  }
}

/** The eval drives only a loopback API. */
function localApi(value: string) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('--api must be a loopback URL');
  return stripTrailing(url.href, '/');
}

type Project = { id: string; workspaceId: string };

type CaseContext = {
  db: Database;
  client: Client;
  project: Project;
  vars: Placeholders;
  write: (record: object) => Promise<void>;
};

/** Runs a case's turns in one chat; a failed turn ends the case. */
async function runCase(context: CaseContext, item: (typeof cases)[number]) {
  const { db, client, project, vars, write } = context;
  let chatId: string | null = null;
  for (const [index, spec] of item.turns.entries()) {
    const step = index + 1;
    try {
      const body = await requestBody(db, project.id, spec, vars, chatId === null);
      const result = await turn(db, client, project, chatId, body);
      chatId = result.chat_id;
      const record = { case: item.id, step, ...result };
      await write(record);
      console.log(summaryLine(record));
    } catch (error) {
      const failed = error instanceof Error ? error.message : String(error);
      await write({ case: item.id, step, failed });
      console.log(`${item.id}#${step} FAILED ${failed}`);
      return;
    }
  }
}

async function resolveProject(
  db: Database,
  email: string,
  requested: string | undefined,
): Promise<Project> {
  const rows = await db
    .selectFrom('projects')
    .innerJoin('workspace_members', 'workspace_members.workspace_id', 'projects.workspace_id')
    .innerJoin('users', 'users.id', 'workspace_members.user_id')
    .select(['projects.id', 'projects.workspace_id', 'projects.name'])
    .where('users.email', '=', email.toLowerCase())
    .orderBy('projects.created_at')
    .execute();
  const project = requested ? rows.find((row) => row.id === requested) : rows[0];
  if (!project)
    throw new Error(
      requested
        ? `Project ${requested} is not available to the local user`
        : 'No project for the local user; pass --project',
    );
  console.log(`Project: ${project.name}`);
  return { id: project.id, workspaceId: project.workspace_id };
}

/** Values the cases name, read from the project so the cases fit any local data. */
async function placeholders(db: Database, projectId: string): Promise<Placeholders> {
  const [project, prompt, competitor] = await Promise.all([
    db
      .selectFrom('projects')
      .select(['name', 'brand_name'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('actions')
      .select('target_label')
      .where('project_id', '=', projectId)
      .where('target_kind', '=', 'prompt')
      .where('status', '=', 'open')
      .orderBy('priority_score', 'desc')
      .executeTakeFirst(),
    db
      .selectFrom('competitors')
      .select('name')
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .executeTakeFirst(),
  ]);
  return {
    brand: project.brand_name ?? project.name,
    top_prompt: prompt?.target_label ?? 'our most important tracked prompt',
    competitor: competitor?.name ?? 'our closest competitor',
  };
}

type RequestBody = { message: string; skill_id?: string; action_id?: string };

async function requestBody(
  db: Database,
  projectId: string,
  spec: TurnSpec,
  vars: Placeholders,
  first: boolean,
): Promise<RequestBody> {
  const message = spec.message.replaceAll(
    PLACEHOLDER,
    (_, key: string) => vars[key as keyof Placeholders],
  );
  if (!spec.action || !first) return { message, skill_id: spec.skill_id };
  let query = db
    .selectFrom('actions')
    .select('id')
    .where('project_id', '=', projectId)
    .where('status', '=', 'open')
    .where('skill_id', '=', spec.action.skill_id);
  if (spec.action.target_kind) query = query.where('target_kind', '=', spec.action.target_kind);
  const action = await query.orderBy('priority_score', 'desc').executeTakeFirst();
  if (!action) throw new Error(`No open ${spec.action.skill_id} Action in the project`);
  return { message, skill_id: spec.skill_id, action_id: action.id };
}

type Client = { api: string; headers: Record<string, string> };

async function call(client: Client, path: string, init: RequestInit = {}) {
  const response = await fetch(`${client.api}${path}`, {
    ...init,
    headers: {
      ...client.headers,
      'X-Request-ID': randomUUID(),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function turn(
  db: Database,
  client: Client,
  project: Project,
  chatId: string | null,
  body: RequestBody,
) {
  const path = chatId ? `/agent/chats/${chatId}/messages` : `/projects/${project.id}/agent/chats`;
  const accepted = agentTurnAcceptedSchema.parse(
    await (
      await call(client, path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(body),
      })
    ).json(),
  );
  const { error, ...timing } = await stream(client, accepted.chat_id, accepted.run.id);
  const detail = agentChatDetailSchema.parse(
    await (await call(client, `/agent/chats/${accepted.chat_id}`)).json(),
  );
  const reply = detail.messages.findLast((message) => message.role === 'agent');
  const revision = detail.output?.latest_revision;
  return {
    chat_id: accepted.chat_id,
    run_id: accepted.run.id,
    message: body.message,
    run_status: detail.latest_run?.status ?? null,
    run_error: detail.latest_run?.error_code || error,
    ...timing,
    ...(await attempts(db, project.workspaceId, accepted.run.id)),
    reply: reply?.content ?? null,
    output:
      detail.output && revision
        ? {
            phase: detail.output.phase,
            revision: revision.number,
            title: revision.title,
            body: revision.body,
          }
        : null,
  };
}

/** Times the first visible text whatever the event shape, so old and new runtimes compare. */
async function stream(client: Client, chatId: string, runId: string) {
  const started = performance.now();
  const response = await call(client, `/agent/chats/${chatId}/runs/${runId}/run`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.body) throw new Error('The run answered without a stream');
  let firstEvent: number | null = null;
  let firstText: number | null = null;
  let error: string | null = null;
  const events: Record<string, number> = {};
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
      const event = parseFrame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (!event) continue;
      const at = Math.round(performance.now() - started);
      const { type, code } = event;
      firstEvent ??= at;
      events[type] = (events[type] ?? 0) + 1;
      if (type === 'reply_delta' || type === 'document_delta') firstText ??= at;
      if (type === 'error') error = String(code);
    }
  }
  return {
    first_event_ms: firstEvent,
    first_text_ms: firstText,
    total_ms: Math.round(performance.now() - started),
    events,
    error,
  };
}

function parseFrame(frame: string) {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data) return null;
  const event = eventSchema.safeParse(JSON.parse(data));
  return event.success ? event.data : null;
}

async function attempts(db: Database, workspaceId: string, runId: string) {
  const [calls, tools] = await Promise.all([
    db
      .selectFrom('agent_model_attempts')
      .select([
        'ordinal',
        'latency_ms',
        'input_tokens',
        'cached_input_tokens',
        'cache_write_input_tokens',
        'output_tokens',
        'reasoning_tokens',
        'finish_status',
      ])
      .where('workspace_id', '=', workspaceId)
      .where('run_id', '=', runId)
      .orderBy('ordinal')
      .execute(),
    db
      .selectFrom('agent_tool_attempts')
      .innerJoin('agent_runs', 'agent_runs.id', 'agent_tool_attempts.run_id')
      .select([
        'agent_tool_attempts.ordinal',
        'agent_tool_attempts.tool_name',
        'agent_tool_attempts.status',
      ])
      .where('agent_runs.workspace_id', '=', workspaceId)
      .where('agent_tool_attempts.run_id', '=', runId)
      .orderBy('agent_tool_attempts.ordinal')
      .execute(),
  ]);
  // A call that reported no count makes the turn's total unknown, not lower.
  const sum = (
    key:
      | 'input_tokens'
      | 'cached_input_tokens'
      | 'cache_write_input_tokens'
      | 'output_tokens'
      | 'reasoning_tokens',
  ) =>
    calls.some((row) => row[key] === null)
      ? null
      : calls.reduce((total, row) => total + Number(row[key]), 0);
  return {
    model_calls: calls.length,
    tool_calls: tools.length,
    input_tokens: sum('input_tokens'),
    cached_input_tokens: sum('cached_input_tokens'),
    cache_write_input_tokens: sum('cache_write_input_tokens'),
    output_tokens: sum('output_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    calls: calls.map((row) => ({ ...row, latency_ms: Number(row.latency_ms) })),
    tools: tools.map((row) => `${row.ordinal}:${row.tool_name}:${row.status}`),
  };
}

function summaryLine(record: EvalRecord) {
  const status = [record.run_status, record.run_error].filter(Boolean).join(' ');
  return (
    `${record.case}#${record.step} ${status} ` +
    `first_text=${record.first_text_ms}ms total=${record.total_ms}ms calls=${record.model_calls} ` +
    `tools=${record.tool_calls} in=${record.input_tokens} cached=${record.cached_input_tokens} written=${record.cache_write_input_tokens} out=${record.output_tokens}`
  );
}

async function load(label: string) {
  const text = await readFile(labelFile(label, '.jsonl'), 'utf8');
  const records = text
    .split('\n')
    .filter(Boolean)
    .map((line) => recordSchema.parse(JSON.parse(line)));
  // A rerun under the same label replaces that turn's earlier record.
  const latest = new Map(records.map((record) => [`${record.case}#${record.step}`, record]));
  return [...latest.values()];
}

function percentile(samples: number[], p: number) {
  if (samples.length === 0) return null;
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function metrics(records: EvalRecord[]): Record<string, string> {
  const done = records.filter((record) => !record.failed);
  const numbers = (key: keyof EvalRecord) =>
    done.map((record) => record[key]).filter((value): value is number => typeof value === 'number');
  // Turns with an unknown count are left out and flagged, never counted as zero.
  const perTurn = (key: keyof EvalRecord, digits = 1) => {
    const samples = numbers(key);
    if (samples.length === 0) return '—';
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const text = digits ? mean.toFixed(digits) : Math.round(mean).toLocaleString('en');
    return samples.length < done.length ? `${text} (${samples.length} turns)` : text;
  };
  const seconds = (key: keyof EvalRecord, p: number) => {
    const ms = percentile(numbers(key), p);
    return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
  };
  const both = done.filter(
    (record) =>
      typeof record.input_tokens === 'number' && typeof record.cached_input_tokens === 'number',
  );
  const input = both.reduce((sum, record) => sum + record.input_tokens!, 0);
  const cached = both.reduce((sum, record) => sum + record.cached_input_tokens!, 0);
  return {
    Turns: `${done.length} of ${records.length}`,
    Succeeded: String(done.filter((record) => record.run_status === 'succeeded').length),
    'First text, median': seconds('first_text_ms', 50),
    'First text, p90': seconds('first_text_ms', 90),
    'Total, median': seconds('total_ms', 50),
    'Total, p90': seconds('total_ms', 90),
    'Model calls per turn': perTurn('model_calls'),
    'Tool calls per turn': perTurn('tool_calls'),
    'Input tokens per turn': perTurn('input_tokens', 0),
    'Cached share of input': input ? `${((100 * cached) / input).toFixed(0)}%` : '—',
    'Cache writes per turn': perTurn('cache_write_input_tokens', 0),
    'Output tokens per turn': perTurn('output_tokens', 0),
  };
}

async function report(labels: string[]) {
  const runs = await Promise.all(
    labels.map(async (label) => ({ label, records: await load(label) })),
  );
  const tables = runs.map((run) => metrics(run.records));
  const rows = Object.keys(tables[0] ?? {}).map(
    (metric) => `| ${metric} | ${tables.map((table) => table[metric]).join(' | ')} |`,
  );
  const table = [
    `| Metric | ${labels.join(' | ')} |`,
    `|---|${labels.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n');
  console.log(table);
  const review = cases.flatMap((item) =>
    item.turns.map((spec, index) => {
      const step = index + 1;
      const found = runs.map((run) => ({
        label: run.label,
        record: run.records.find((record) => record.case === item.id && record.step === step),
      }));
      const answers = found.map(({ label, record }) => answer(label, record));
      const asked = found.map(({ record }) => record?.message).find(Boolean) ?? spec.message;
      return [
        `## ${item.id} · turn ${step}`,
        `**Asked:** ${asked}`,
        `**Check:** ${item.review}`,
        ...answers,
      ].join('\n\n');
    }),
  );
  const file = labelFile(`report-${labels.join('-vs-')}`, '.md');
  await writeFile(file, [`# Agent eval: ${labels.join(' vs ')}`, table, ...review].join('\n\n'));
  console.log(`\nReview written to ${file}`);
}

function answer(label: string, record: EvalRecord | undefined) {
  const parts = [`### ${label}`];
  if (record?.failed) parts.push(`Failed: ${record.failed}`);
  else parts.push(record?.reply ?? '(no turn)');
  const output = record?.failed ? null : record?.output;
  if (output) parts.push(`**Document (${output.phase}): ${output.title}**`, output.body);
  return parts.join('\n\n');
}

// Runs after every declaration above is initialised.
if (values.report) await report(values.report.split(','));
else await live();
