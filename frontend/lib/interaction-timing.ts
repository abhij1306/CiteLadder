import {
  CLIENT_ERROR_FIELD_LIMITS,
  SLOW_INTERACTION_SCRIPT_LIMIT,
  withoutQueryStrings,
  type SlowInteractionReport,
} from '@citeladder/contracts/client-errors';
import { z } from 'zod';

import { releaseId, reportRoute, sendClientReport } from '@/lib/client-errors';
import { INTERACTION_REPORT_SAMPLE_RATE, SLOW_INTERACTION_MS } from '@/lib/config/operational';

const interactionSchema = z.object({
  name: z.string(),
  startTime: z.number(),
  duration: z.number(),
  processingStart: z.number(),
  processingEnd: z.number(),
  interactionId: z.number(),
  target: z.unknown(),
});
export type Interaction = z.infer<typeof interactionSchema>;

const frameSchema = z.object({
  startTime: z.number(),
  duration: z.number(),
  scripts: z.array(z.object({ invoker: z.string(), sourceURL: z.string(), duration: z.number() })),
});
export type AnimationFrame = z.infer<typeof frameSchema>;

const FRAMES_KEPT = 50;
const limits = CLIENT_ERROR_FIELD_LIMITS;

const milliseconds = (value: number) => Math.min(600_000, Math.max(0, Math.round(value)));

function tagName(target: unknown): string | null {
  if (!(target instanceof Element)) return null;
  return /^[a-z][a-z0-9-]{0,63}$/u.test(target.localName) ? target.localName : null;
}

export function slowInteractionReport({
  interaction,
  frames,
  route,
  release,
}: Readonly<{
  interaction: Interaction;
  frames: readonly AnimationFrame[];
  route: string;
  release: string;
}>): SlowInteractionReport | null {
  if (interaction.duration < SLOW_INTERACTION_MS || !/^[a-z]{1,32}$/u.test(interaction.name)) {
    return null;
  }
  const end = interaction.startTime + interaction.duration;
  const scripts = frames
    .filter(
      (frame) => frame.startTime < end && frame.startTime + frame.duration > interaction.startTime,
    )
    .flatMap((frame) => frame.scripts)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, SLOW_INTERACTION_SCRIPT_LIMIT)
    .map((script) => ({
      source: withoutQueryStrings(script.sourceURL).slice(0, limits.script),
      invoker: withoutQueryStrings(script.invoker).slice(0, limits.invoker),
      duration_ms: milliseconds(script.duration),
    }));
  return {
    kind: 'slow_interaction',
    route,
    release,
    event: interaction.name,
    target: tagName(interaction.target),
    duration_ms: milliseconds(interaction.duration),
    input_delay_ms: milliseconds(interaction.processingStart - interaction.startTime),
    processing_ms: milliseconds(interaction.processingEnd - interaction.processingStart),
    presentation_ms: milliseconds(end - interaction.processingEnd),
    scripts,
  };
}

export function installInteractionTiming(): void {
  const supported = PerformanceObserver.supportedEntryTypes;
  if (Math.random() >= INTERACTION_REPORT_SAMPLE_RATE || !supported.includes('event')) return;
  let slowest: { interaction: Interaction; route: string } | null = null;
  const frames: AnimationFrame[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const parsed = interactionSchema.safeParse(entry);
      if (!parsed.success || parsed.data.interactionId === 0) continue;
      if (slowest && parsed.data.duration <= slowest.interaction.duration) continue;
      slowest = { interaction: parsed.data, route: reportRoute() };
    }
  }).observe({ type: 'event', buffered: true });
  if (supported.includes('long-animation-frame')) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const parsed = frameSchema.safeParse(entry.toJSON());
        if (parsed.success) frames.push(parsed.data);
      }
      frames.splice(0, Math.max(0, frames.length - FRAMES_KEPT));
    }).observe({ type: 'long-animation-frame', buffered: true });
  }
  const flush = () => {
    if (document.visibilityState !== 'hidden' || !slowest) return;
    const report = slowInteractionReport({ ...slowest, frames, release: releaseId() });
    if (!report) return;
    document.removeEventListener('visibilitychange', flush);
    sendClientReport(report);
  };
  document.addEventListener('visibilitychange', flush);
}
