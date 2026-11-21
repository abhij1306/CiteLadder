import type { ProbeMarket, ProbeMarketValue } from '@citeladder/contracts/probes';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { ProjectScope as Scope } from '../projects/brand-profile.ts';
import { probeAnswers, type ProbeAnswer } from './answers.ts';
import type { TrackedName } from './label-model.ts';
import { labelledLaunches } from './launches.ts';
import { probeSubject } from './questions.ts';
import { distinctPlaces, firstPlaces, positionScores, rankOf, scoreOf } from './scores.ts';

type Theme = { id: string; name: string };
type KnownFor = ProbeMarketValue['known_for'][number];
const OTHER = 'other';
const BRAND = 'brand';
const TOP_THEMES = 3;

function knownFor(answers: readonly ProbeAnswer[], themes: readonly Theme[]) {
  const asked = answers.filter((answer) => answer.question.question === 'known_for');
  const scores = positionScores(
    asked.map((answer) =>
      distinctPlaces(
        answer.items
          .filter((item) => item.question === 'known_for')
          .map((item) => ({ key: item.theme_id ?? OTHER, rank: item.rank })),
      ),
    ),
  );
  const names = new Map(themes.map((theme) => [theme.id, theme.name]));
  return [...scores]
    .flatMap(([key, { score }]): KnownFor[] => {
      const theme = key === OTHER ? policy.perception.project_themes.fallback : names.get(key);
      if (!theme) return [];
      return [{ theme_id: key === OTHER ? null : key, theme, score }];
    })
    .sort((a, b) => b.score - a.score || a.theme.localeCompare(b.theme));
}

function themeRow(answers: readonly ProbeAnswer[], roster: readonly TrackedName[]) {
  const scores = positionScores(
    answers.map((answer) =>
      firstPlaces(
        answer.items
          .filter((item) => item.question === 'theme')
          .map((item) => ({ key: item.entity_id ?? BRAND, rank: item.rank })),
      ),
    ),
  );
  const entities = roster.map(({ kind, id, name }) => ({
    kind,
    id,
    name,
    key: id ?? BRAND,
    score: scoreOf(scores, id ?? BRAND, answers.length) ?? 0,
    named: (scores.get(id ?? BRAND)?.raised ?? 0) > 0,
  }));
  const own = entities.find((entity) => entity.kind === 'brand')!;
  const leader = entities.reduce(
    (best, entity) =>
      entity.score > best.score || (entity.score === best.score && entity.named && !best.named)
        ? entity
        : best,
    own,
  );
  const shown = ({ kind, id, name, score, named }: (typeof entities)[number]) => ({
    kind,
    id,
    name,
    score,
    named,
  });
  return {
    entities: entities.map(shown),
    rank: rankOf(entities, BRAND)!,
    of: entities.length,
    leader: shown(leader),
    gap: leader.score - own.score,
  };
}

const themeAnswers = (answers: readonly ProbeAnswer[], themeId: string) =>
  answers.filter(
    (answer) => answer.question.question === 'theme' && answer.question.theme_id === themeId,
  );

export function rankInTopTheme(
  own: readonly ProbeAnswer[],
  top: readonly KnownFor[],
  roster: readonly TrackedName[],
): ProbeMarketValue['engines'][number]['rank_in_top_theme'] {
  const first = top.find((row) => row.theme_id !== null)?.theme_id;
  if (!first) return { kind: 'no_theme' };
  const asked = themeAnswers(own, first);
  if (!asked.length) return { kind: 'not_asked' };
  const row = themeRow(asked, roster);
  const named = row.entities.some((entity) => entity.kind === 'brand' && entity.named);
  return named ? { kind: 'rank', rank: row.rank } : { kind: 'not_named' };
}

function oneLanguage(markets: readonly { language_code: string }[]) {
  const [language = '', ...others] = new Set(markets.map((market) => market.language_code));
  return others.length ? '' : language;
}

export async function probeMarket(db: Database, scope: Scope): Promise<ProbeMarket> {
  const [latest] = await labelledLaunches(db, scope, 1);
  if (!latest) return { state: 'none' };
  const [answers, subject] = await Promise.all([
    probeAnswers(db, scope, latest.ids),
    probeSubject(db, scope),
  ]);
  const { themes } = subject;
  const rows = themes.flatMap((theme) => {
    const asked = themeAnswers(answers, theme.id);
    if (!asked.length) return [];
    return [{ theme_id: theme.id, theme: theme.name, ...themeRow(asked, latest.roster) }];
  });
  const engines = latest.basis.engines.map((engine) => {
    const own = answers.filter((answer) => answer.engine === engine);
    const top = knownFor(own, themes)
      .filter((row) => row.score > 0)
      .slice(0, TOP_THEMES);
    return {
      engine,
      answered: own.some((answer) => answer.question.question === 'known_for'),
      top_themes: top.map(({ theme_id, theme }) => ({ theme_id, theme })),
      rank_in_top_theme: rankInTopTheme(own, top, latest.roster),
    };
  });
  return {
    state: 'value',
    probe: { ...latest.basis, answers: answers.length },
    brand: latest.brand,
    category: subject.category,
    language_code: oneLanguage(latest.basis.markets),
    known_for_answers: answers.filter((answer) => answer.question.question === 'known_for').length,
    known_for: knownFor(answers, themes),
    themes: rows,
    engines,
  };
}
