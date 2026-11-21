import { MARKET_COUNTRIES } from '@citeladder/contracts/markets';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import type { Engine } from '../providers/config.ts';
import { listThemes } from '../projects/themes.ts';
import { scalarText } from '../text-order.ts';

const probes = policy.probes;

const probeQuestionSchema = z.discriminatedUnion('question', [
  z.object({ question: z.literal('known_for') }),
  z.object({ question: z.literal('objection') }),
  z.object({ question: z.literal('theme'), theme_id: z.uuid(), theme_name: z.string() }),
]);
export type ProbeQuestion = z.infer<typeof probeQuestionSchema>;

export function frozenQuestion(evidence: unknown): ProbeQuestion | null {
  const parsed = probeQuestionSchema.safeParse(record(evidence).probe);
  return parsed.success ? parsed.data : null;
}

export type FrozenPrompt = {
  id: string | null;
  text: string;
  theme: string;
  topic_id: string | null;
  topic_name: string | null;
  intent: string;
  buyer_stage: string;
  prompt_intent: string;
  cohort: string;
  generation_evidence: unknown;
};

function probeCategory(context: unknown, industry: string) {
  return scalarText(record(context).category).trim() || industry.trim();
}

export function countryName(countryCode: string) {
  const code = countryCode.trim().toUpperCase();
  return MARKET_COUNTRIES.find((country) => country.value === code)?.label ?? code;
}

export function probeQuestions(input: {
  brand: string;
  category: string;
  country: string;
  themes: readonly { id: string; name: string }[];
}): FrozenPrompt[] {
  const ask = (text: string, question: ProbeQuestion): FrozenPrompt => ({
    id: null,
    text,
    theme: '',
    topic_id: null,
    topic_name: null,
    intent: '',
    buyer_stage: '',
    prompt_intent: '',
    cohort: probes.cohort,
    generation_evidence: { probe: question },
  });
  const named = (template: string) => template.replaceAll('{brand}', input.brand);
  return [
    ask(named(probes.questions.known_for), { question: 'known_for' }),
    ask(named(probes.questions.objection), { question: 'objection' }),
    ...input.themes.map((theme) =>
      ask(
        probes.questions.theme
          .replaceAll('{category}', input.category)
          .replaceAll('{country}', input.country)
          .replaceAll('{theme}', theme.name.toLowerCase()),
        { question: 'theme', theme_id: theme.id, theme_name: theme.name },
      ),
    ),
  ];
}

export async function probeSubject(
  db: Database,
  scope: { workspaceId: string; projectId: string },
) {
  const project = await db
    .selectFrom('projects as p')
    .leftJoin('brands as b', (join) =>
      join.onRef('b.project_id', '=', 'p.id').onRef('b.workspace_id', '=', 'p.workspace_id'),
    )
    .leftJoin('brand_profiles as profile', (join) =>
      join
        .onRef('profile.project_id', '=', 'p.id')
        .onRef('profile.workspace_id', '=', 'p.workspace_id'),
    )
    .select(['p.brand_name', 'p.industry', 'b.name as brand', 'profile.business_context'])
    .where('p.workspace_id', '=', scope.workspaceId)
    .where('p.id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  return {
    brand: project.brand ?? project.brand_name,
    category: probeCategory(project.business_context, project.industry),
    themes: await listThemes(db, scope),
  };
}

export async function probePrompts(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  countryCode: string,
) {
  return probeQuestions({ ...(await probeSubject(db, scope)), country: countryName(countryCode) });
}

export function probeEngines(requested: readonly Engine[]): Engine[] {
  const engines = [...new Set(requested)].filter((engine) => probes.engines.includes(engine));
  if (!engines.length)
    throw new ApiError(422, 'No selected engine can run a probe', { code: 'probe_engines' });
  return engines;
}
