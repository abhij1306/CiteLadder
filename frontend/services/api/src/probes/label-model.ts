import { z } from 'zod';

import { namesEntity } from '../analysis/aliases.ts';
import type { ProbePolicy } from '../config/probes.ts';
import { cleanName, idsByName, nameKey } from '../projects/themes.ts';

export type LabelAnswer = { taskId: string; text: string };
type Named = { id: string; name: string };

const number = z.int().positive();
const quote = z.string().default('');
export const knownForOutput = z.object({
  answers: z.array(
    z.object({
      answer: number,
      points: z.array(z.object({ theme: z.string(), quote })),
    }),
  ),
});
export const objectionOutput = z.object({
  answers: z.array(
    z.object({
      answer: number,
      reasons: z.array(z.object({ group: z.string(), quote })),
    }),
  ),
});
export const themeOutput = z.object({
  answers: z.array(z.object({ answer: number, brands: z.array(z.string()) })),
});

export function covering<Value extends { answers: readonly { answer: number }[] }>(
  schema: z.ZodType<Value>,
  count: number,
) {
  return schema.refine((value) => {
    const listed = new Set(value.answers.map((row) => row.answer));
    return Array.from({ length: count }, (_, index) => index + 1).every((n) => listed.has(n));
  }, 'Every answer must be labelled');
}

const QUOTE_MAX = 500;

function answersBlock(answers: readonly LabelAnswer[], maxChars: number) {
  return answers
    .map(
      (answer, index) =>
        `Answer ${index + 1}:\n${Array.from(answer.text).slice(0, maxChars).join('')}`,
    )
    .join('\n\n');
}

function render(template: string, slots: Record<string, string>) {
  return template.replaceAll(/\{[a-z_]+\}/gu, (slot) => slots[slot] ?? slot);
}

export function knownForRequest(
  policy: ProbePolicy,
  input: {
    brand: string;
    fallback: string;
    themes: readonly Named[];
    answers: readonly LabelAnswer[];
  },
) {
  return render(policy.known_for_template, {
    '{brand}': input.brand,
    '{themes}': input.themes.map((theme) => theme.name).join(', ') || '(none)',
    '{fallback}': input.fallback,
    '{max_items}': String(policy.max_items_per_answer),
    '{answers}': answersBlock(input.answers, policy.max_answer_chars),
  });
}

export function objectionRequest(
  policy: ProbePolicy,
  input: { brand: string; groups: readonly { name: string }[]; answers: readonly LabelAnswer[] },
) {
  return render(policy.objection_template, {
    '{brand}': input.brand,
    '{groups}': input.groups.map((group) => `"${group.name}"`).join(', ') || '(none yet)',
    '{max_items}': String(policy.max_items_per_answer),
    '{answers}': answersBlock(input.answers, policy.max_answer_chars),
  });
}

export function themeRequest(
  policy: ProbePolicy,
  input: { question: string; answers: readonly LabelAnswer[] },
) {
  return render(policy.theme_template, {
    '{question}': input.question,
    '{max_items}': String(policy.max_items_per_answer),
    '{answers}': answersBlock(input.answers, policy.max_answer_chars),
  });
}

function byAnswer<Entry>(
  answers: readonly LabelAnswer[],
  output: readonly { answer: number; entries: readonly Entry[] }[],
  maxItems: number,
) {
  const seen = new Set<number>();
  return output.flatMap(({ answer, entries }) => {
    const task = answers[answer - 1];
    if (!task || seen.has(answer)) return [];
    seen.add(answer);
    return [{ taskId: task.taskId, entries: entries.slice(0, maxItems) }];
  });
}

const clip = (text: string) => Array.from(text.trim()).slice(0, QUOTE_MAX).join('');

export function mapKnownFor(
  output: z.infer<typeof knownForOutput>,
  answers: readonly LabelAnswer[],
  input: { themes: readonly Named[]; maxItems: number },
) {
  const themes = idsByName(input.themes);
  return byAnswer(
    answers,
    output.answers.map((row) => ({ answer: row.answer, entries: row.points })),
    input.maxItems,
  ).flatMap(({ taskId, entries }) =>
    entries.map((point, rank) => ({
      taskId,
      rank,
      themeId: themes.get(nameKey(point.theme)) ?? null,
      quote: clip(point.quote),
    })),
  );
}

export type GroupRef = { kind: 'existing'; id: string } | { kind: 'new'; name: string };

export function mapObjections(
  output: z.infer<typeof objectionOutput>,
  answers: readonly LabelAnswer[],
  input: {
    groups: readonly Named[];
    named?: readonly string[];
    maxItems: number;
    maxNewGroups: number;
    nameMaxChars: number;
  },
) {
  const existing = idsByName(input.groups);
  const created = new Map((input.named ?? []).map((name) => [nameKey(name), name]));
  const refOf = (raw: string): GroupRef | null => {
    const name = Array.from(cleanName(raw)).slice(0, input.nameMaxChars).join('');
    if (!name) return null;
    const id = existing.get(nameKey(name));
    if (id) return { kind: 'existing', id };
    const prior = created.get(nameKey(name));
    if (prior) return { kind: 'new', name: prior };
    if (created.size >= input.maxNewGroups) return null;
    created.set(nameKey(name), name);
    return { kind: 'new', name };
  };
  const items = byAnswer(
    answers,
    output.answers.map((row) => ({ answer: row.answer, entries: row.reasons })),
    input.maxItems,
  ).flatMap(({ taskId, entries }) =>
    entries.flatMap((reason, rank) => {
      const group = refOf(reason.group);
      return group ? [{ taskId, rank, group, quote: clip(reason.quote) }] : [];
    }),
  );
  return { items, newGroups: [...created.values()] };
}

export type TrackedName = ({ kind: 'brand'; id: null } | { kind: 'competitor'; id: string }) & {
  name: string;
  aliases: readonly string[];
};

export function mapThemeBrands(
  output: z.infer<typeof themeOutput>,
  answers: readonly LabelAnswer[],
  input: { tracked: readonly TrackedName[]; maxItems: number },
) {
  return byAnswer(
    answers,
    output.answers.map((row) => ({ answer: row.answer, entries: row.brands })),
    input.maxItems,
  ).flatMap(({ taskId, entries }) => {
    const found = new Set<TrackedName>();
    return entries.flatMap((listed, rank) => {
      const entity = input.tracked.find(
        (candidate) =>
          !found.has(candidate) && namesEntity(listed, [candidate.name, ...candidate.aliases]),
      );
      if (!entity) return [];
      found.add(entity);
      return [{ taskId, rank, entity }];
    });
  });
}
