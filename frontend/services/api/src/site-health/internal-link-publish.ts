import {
  internalLinkAnalysisSchema,
  internalLinkPageSchema,
  internalLinkPlacementSchema,
  type InternalLink,
  type InternalLinkPage,
} from '@citeladder/contracts/site-health';
import { z } from 'zod';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import type { Executor } from '../workers/executor.ts';
import { payloadString, taskProject } from '../workers/executor.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import type { LinkCandidate } from './internal-link-candidates.ts';

const probability = z.number().min(0).max(1);
const noul = z.object({ type: z.literal('noul'), noul: probability });
const choice = z.object({ type: z.literal('choice'), choice: z.string() });

function summary(page: InternalLinkPage) {
  const { contextual_targets: _targets, source_passages: _passages, ...rest } = page;
  return rest;
}

/** Only an explicit selection of a frozen, source-grounded placement can publish. */
function selectedPlacement(candidate: LinkCandidate, source: InternalLinkPage, raw: unknown) {
  const answer = choice.safeParse(raw);
  const index = answer.success ? /^a(\d+)$/u.exec(answer.data.choice) : null;
  if (!index) return null;
  const parsed = internalLinkPlacementSchema.safeParse(candidate.placements?.[Number(index[1])]);
  if (!parsed.success) return null;
  const placement = parsed.data;
  return placement.anchor &&
    placement.end === placement.start + placement.text.length &&
    placement.text.slice(
      placement.anchor_start,
      placement.anchor_start + placement.anchor.length,
    ) === placement.anchor &&
    source.source_passages?.some(
      (passage) =>
        passage.start === placement.start &&
        passage.end === placement.end &&
        passage.text === placement.text,
    )
    ? placement
    : null;
}

function emptyDiagnostics(candidates: number) {
  return {
    candidates,
    completed: 0,
    pending: 0,
    unavailable: 0,
    below_threshold: 0,
    reasons: {} as Record<string, number>,
    elapsed_seconds: 0,
  };
}

type Diagnostics = ReturnType<typeof emptyDiagnostics>;

function countReason(diagnostics: Diagnostics, reason: string) {
  diagnostics.reasons[reason] = (diagnostics.reasons[reason] ?? 0) + 1;
}

/** One judged candidate as a publishable link, or null after counting why not. */
function resolveCandidate(
  candidate: LinkCandidate,
  outcome: Record<string, unknown>,
  pages: Map<string, InternalLinkPage>,
  threshold: number,
  diagnostics: Diagnostics,
): InternalLink | null {
  const answers = record(outcome.answers);
  const judgment = noul.safeParse(answers.link);
  if (outcome.state !== 'completed' || !judgment.success) {
    countReason(diagnostics, typeof outcome.reason === 'string' ? outcome.reason : 'unavailable');
    diagnostics.unavailable += 1;
    return null;
  }
  diagnostics.completed += 1;
  if (judgment.data.noul < threshold) {
    diagnostics.below_threshold += 1;
    return null;
  }
  const source = pages.get(candidate.source);
  const target = pages.get(candidate.target);
  if (!source || !target) throw new Error('Link candidate has no frozen page');
  const placement = selectedPlacement(candidate, source, answers.anchor);
  if (!placement) {
    const selection = choice.safeParse(answers.anchor);
    if (selection.success && selection.data.choice === 'none') {
      countReason(diagnostics, 'no_placement');
    } else {
      countReason(diagnostics, 'invalid_placement');
      diagnostics.completed -= 1;
      diagnostics.unavailable += 1;
    }
    return null;
  }
  return {
    id: candidate.id,
    source: summary(source),
    target: summary(target),
    anchor: placement.anchor,
    placement,
    usefulness: judgment.data.noul,
    action_id: null,
    action_status: null,
  };
}

function linkState(diagnostics: Diagnostics, omittedPages: unknown) {
  if (diagnostics.pending) return 'running';
  if (diagnostics.candidates && diagnostics.unavailable === diagnostics.candidates)
    return 'unavailable';
  if (diagnostics.unavailable || Number(omittedPages)) return 'partial';
  return 'completed';
}

/**
 * Most useful first; a link whose anchor overlaps a kept one on the same source
 * is dropped, and a destination keeps at most `perTarget` of its best links.
 */
function dedupeOverlaps(links: InternalLink[], perTarget: number, diagnostics: Diagnostics) {
  const anchorStart = (link: InternalLink) => link.placement!.start + link.placement!.anchor_start;
  const recommendations: InternalLink[] = [];
  const kept = new Map<string, number>();
  for (const link of links.toSorted(
    (a, b) =>
      b.usefulness - a.usefulness ||
      a.source.url.localeCompare(b.source.url) ||
      a.target.url.localeCompare(b.target.url),
  )) {
    const start = anchorStart(link);
    const overlaps = recommendations.some((other) => {
      const otherStart = anchorStart(other);
      return (
        other.source.analysis_id === link.source.analysis_id &&
        start < otherStart + other.anchor.length &&
        otherStart < start + link.anchor.length
      );
    });
    const targetCount = kept.get(link.target.analysis_id) ?? 0;
    if (overlaps) countReason(diagnostics, 'overlapping_placement');
    else if (targetCount >= perTarget) countReason(diagnostics, 'target_cap');
    else {
      kept.set(link.target.analysis_id, targetCount + 1);
      recommendations.push(link);
    }
  }
  return recommendations;
}

export function projectLinks(manifest: Record<string, unknown>, outcomes: Map<string, unknown>) {
  const pages = new Map(
    internalLinkPageSchema
      .array()
      .parse(manifest.pages)
      .map((page) => [page.analysis_id, page]),
  );
  const candidates = manifest.candidates as LinkCandidate[];
  const frozen = record(manifest.policy);
  const threshold = Number(frozen.accept_threshold);
  const perTarget = Number(frozen.max_links_per_target);
  const diagnostics = emptyDiagnostics(candidates.length);
  const sourcesWithoutPassages = [...pages.values()].filter(
    (page) => !page.source_passages?.length,
  ).length;
  const links: InternalLink[] = [];
  for (const candidate of candidates) {
    if (!outcomes.has(candidate.id)) {
      diagnostics.pending += 1;
      continue;
    }
    const outcome = record(outcomes.get(candidate.id));
    const link = resolveCandidate(candidate, outcome, pages, threshold, diagnostics);
    if (link) links.push(link);
  }
  const state = linkState(diagnostics, manifest.omitted_pages);
  return {
    recommendations: dedupeOverlaps(links, perTarget, diagnostics),
    diagnostics: { ...diagnostics, sources_without_passages: sourcesWithoutPassages },
    state,
  };
}

export const publishInternalLinks: Executor = async (task, { db, checkCancelled }) => {
  const projectId = await taskProject(db, task);
  const runId = payloadString(task, 'run_id');
  if (!runId) throw new Error('Internal link publication missing run');
  await checkCancelled('publication');
  await db.transaction().execute(async (trx) => {
    const lease = await trx
      .selectFrom('analytics_tasks')
      .select('id')
      .where('id', '=', task.id)
      .where('lease_owner', '=', task.lease_owner)
      .where('status', '=', policy.task_queue.statuses.running)
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .forUpdate()
      .executeTakeFirst();
    if (!lease) return;
    const run = await trx
      .selectFrom('site_internal_link_runs')
      .selectAll()
      .where('id', '=', runId)
      .where('workspace_id', '=', task.workspace_id)
      .where('project_id', '=', projectId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !run ||
      run.state === 'cancelled' ||
      (run.result && !['queued', 'running'].includes(run.state))
    )
      return;
    // Outcomes only: dispatch rows carry request bodies publication never needs.
    const events = await trx
      .selectFrom('site_internal_link_events')
      .select(['candidate_id', 'kind', 'created_at', 'evidence'])
      .where('run_id', '=', runId)
      .where('workspace_id', '=', task.workspace_id)
      .where('project_id', '=', projectId)
      .where('kind', '=', 'outcome')
      .execute();
    const manifest = record(run.manifest);
    const projection = projectLinks(
      manifest,
      new Map(events.map((event) => [event.candidate_id, event.evidence])),
    );
    const latest = Math.max(
      run.created_at.getTime(),
      ...events.map((event) => event.created_at.getTime()),
    );
    projection.diagnostics.elapsed_seconds = (latest - run.created_at.getTime()) / 1000;
    const result = internalLinkAnalysisSchema.parse({
      id: run.id,
      crawl_id: run.crawl_id,
      created_at: run.created_at.toISOString(),
      page_count: manifest.page_count,
      omitted_pages: manifest.omitted_pages,
      stale: false,
      ...projection,
    });
    await trx
      .updateTable('site_internal_link_runs')
      .set({ state: result.state, result: JSON.stringify(result) })
      .where('id', '=', run.id)
      .where('workspace_id', '=', task.workspace_id)
      .execute();
    if (result.state !== 'running')
      await enqueueTask(trx, {
        workspaceId: task.workspace_id,
        projectId,
        kind: 'opportunity_refresh',
        payload: { crawl_id: run.crawl_id },
        keyParts: ['internal-links', run.id],
        maxAttempts: task.max_attempts,
      });
  });
};
