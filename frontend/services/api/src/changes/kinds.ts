import { actionKinds } from './action-kinds.ts';
import { auditKinds } from './audit-kinds.ts';
import { brandKinds } from './brand-kinds.ts';
import { commerceKinds } from './commerce-kinds.ts';
import { dataKinds } from './data-kinds.ts';
import { discoveryKinds } from './discovery-kinds.ts';
import { importKinds } from './import-kinds.ts';
import { projectKinds } from './project-kinds.ts';
import { promptKinds } from './prompt-kinds.ts';
import { promptSetKinds } from './prompt-set-kinds.ts';
import { researchKinds } from './research-kinds.ts';
import { siteHealthKinds } from './site-health-kinds.ts';
import { themeKinds } from './theme-kinds.ts';

const changeAreas = {
  'Prompts and topics': { ...promptKinds, ...promptSetKinds },
  'Project, markets and competitors': projectKinds,
  Audits: { ...auditKinds },
  'Site Health': siteHealthKinds,
  Actions: actionKinds,
  'Keyword research': researchKinds,
  'Demand and connected data': dataKinds,
  Commerce: commerceKinds,
  'Brand, facts and themes (facts and verdicts need fact checking)': {
    ...brandKinds,
    ...themeKinds,
  },
  'Brand discovery (sets up a new project)': discoveryKinds,
  Imports: importKinds,
};

export const changeKinds = {
  ...promptKinds,
  ...promptSetKinds,
  ...projectKinds,
  ...auditKinds,
  ...siteHealthKinds,
  ...actionKinds,
  ...researchKinds,
  ...dataKinds,
  ...commerceKinds,
  ...brandKinds,
  ...themeKinds,
  ...discoveryKinds,
  ...importKinds,
};

export type ChangeKind = keyof typeof changeKinds;

export const CHANGE_KINDS = Object.keys(changeKinds).filter((kind): kind is ChangeKind =>
  Object.hasOwn(changeKinds, kind),
);

export function memberOf<K extends string>(list: readonly K[]) {
  return (kind: string): kind is K => list.some((listed) => listed === kind);
}

function areaLines(
  [area, kinds]: [string, Record<string, { purpose: string }>],
  offered: (kind: string) => boolean,
) {
  const listed = Object.entries(kinds).filter(([kind]) => offered(kind));
  if (!listed.length) return [];
  return [`${area}:`, ...listed.map(([kind, entry]) => `- ${kind}: ${entry.purpose}`)];
}

export function kindLines(offered: (kind: string) => boolean) {
  return Object.entries(changeAreas).flatMap((area) => areaLines(area, offered));
}
