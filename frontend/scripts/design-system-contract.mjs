import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postcss from 'postcss';

/**
 * The design system's own contract (docs/design.md): globals.css carries
 * exactly the system's tokens (design-system-tokens.json, a copy of the
 * artifact's tokens.json) with its values in both themes.
 */

const TOKEN_CSS = 'apps/app/src/globals.css';
const CONTRACT = 'scripts/design-system-tokens.json';
const FONT_CONFIG = 'apps/app/index.html';
const DARK = ":root[data-theme='dark']";

const readContract = (root) => JSON.parse(readFileSync(join(root, CONTRACT), 'utf8'));

/** `rgba(17,17,17,0.08)` and `rgb(17 17 17 / 8%)` alike, as comparable text. */
function normalColour(value) {
  const text = String(value).trim().toLowerCase();
  const legacy = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (legacy) {
    const alpha = legacy[4] === undefined ? '' : ` / ${Math.round(Number(legacy[4]) * 100)}%`;
    return `rgb(${legacy[1]} ${legacy[2]} ${legacy[3]}${alpha})`;
  }
  return text.replaceAll(/\s+/g, ' ');
}

/** A shadow value as comparable text: colours normalised, spacing collapsed. */
function normalShadow(value) {
  return String(value)
    .replaceAll(/rgba?\([^)]*\)/gi, (colour) => normalColour(colour))
    .replaceAll(/#1{6}/gi, 'var(--color-ink)')
    .split(',')
    .map((layer) => layer.replaceAll(/\s+/g, ' ').trim())
    .join(', ')
    .toLowerCase();
}

/** The system's `{name}` reference as the repo's alias. */
const contractColour = (value) => {
  const reference = /^\{([\w-]+)\}$/.exec(value);
  return reference ? `var(--color-${reference[1]})` : normalColour(value);
};

/** Every declaration in `@theme`, `:root` and the dark block, by scope. */
function declarationsByScope(css) {
  const scopes = { light: new Map(), dark: new Map() };
  postcss.parse(css).walkDecls((decl) => {
    const parent = decl.parent;
    if (parent?.parent?.type !== 'root') return;
    const isTheme = parent.type === 'atrule' && parent.name === 'theme';
    const selector = parent.type === 'rule' ? parent.selector.replace(/\s+/g, ' ').trim() : '';
    if (isTheme || selector === ':root') scopes.light.set(decl.prop, decl.value.trim());
    else if (selector === DARK) scopes.dark.set(decl.prop, decl.value.trim());
  });
  return scopes;
}

function colourFindings(contract, scopes) {
  const findings = [];
  const declared = [...scopes.light.keys()].filter(
    (token) => token.startsWith('--color-') && !token.includes('*'),
  );
  const names = new Set(contract.color.tokens.map(({ name }) => `--color-${name}`));
  for (const { name, value } of contract.color.tokens) {
    const token = `--color-${name}`;
    const light = scopes.light.get(token);
    if (light === undefined) {
      findings.push(`${token} is a system colour and must be declared in @theme`);
      continue;
    }
    if (normalColour(light) !== contractColour(value.light))
      findings.push(`${token} is ${light} in light; the system says ${value.light}`);
    const dark = scopes.dark.get(token) ?? light;
    if (normalColour(dark) !== contractColour(value.dark))
      findings.push(`${token} is ${dark} in dark; the system says ${value.dark}`);
  }
  // The only colours beyond the system's are the real third-party marks.
  for (const token of declared) {
    if (!names.has(token) && !token.startsWith('--color-brand-'))
      findings.push(`${token} is not a system colour; the system has no such token`);
  }
  for (const token of scopes.dark.keys()) {
    if (token.startsWith('--color-') && !names.has(token))
      findings.push(`${token} is rebound in dark but is not a system colour`);
  }
  return findings;
}

function typeFindings(contract, scopes) {
  const findings = [];
  const expected = new Map();
  for (const group of contract.type.groups) {
    for (const style of group.styles) {
      const base = `--text-${style.name}`;
      expected.set(base, style.fontSize);
      expected.set(`${base}--line-height`, style.lineHeight);
      expected.set(`${base}--font-weight`, String(style.fontWeight));
      if (style.letterSpacing) expected.set(`${base}--letter-spacing`, style.letterSpacing);
    }
  }
  for (const [token, value] of expected) {
    const declared = scopes.light.get(token);
    if (declared !== value)
      findings.push(`${token} is ${declared ?? 'missing'}; the system says ${value}`);
  }
  for (const token of scopes.light.keys()) {
    if (token.startsWith('--text-') && !token.includes('*') && !expected.has(token))
      findings.push(`${token} is not a system type style`);
  }
  return findings;
}

/** Radii globals.css declares that the system does not have. */
function extraRadiusFindings(contract, scopes) {
  const names = new Set(contract.radius.tokens.map(({ name }) => `--${name}`));
  return [...scopes.light.keys()]
    .filter((token) => token.startsWith('--radius-') && !token.includes('*') && !names.has(token))
    .map((token) => `${token} is not a system radius`);
}

/** Tokens a single-value family must carry exactly, keyed as globals.css names them. */
function scalarFindings(contract, scopes) {
  const findings = [];
  const expect = (token, value) => {
    const declared = scopes.light.get(token);
    if (declared !== value)
      findings.push(`${token} is ${declared ?? 'missing'}; the system says ${value}`);
  };
  for (const { name, value } of contract.radius.tokens) expect(`--${name}`, value);
  for (const { name, value } of contract.control.tokens) expect(`--${name}`, value);
  for (const { name, value } of contract.layout.tokens) expect(`--${name}`, value);
  findings.push(...extraRadiusFindings(contract, scopes));
  // space-N is Tailwind's N on a 4px step.
  const steps = contract.spacing.tokens.map(({ name, value }) => [
    Number(name.replace('space-', '')),
    Number.parseFloat(value),
  ]);
  if (scopes.light.get('--spacing') !== '4px' || steps.some(([step, px]) => step * 4 !== px))
    findings.push('--spacing must be 4px so `p-N` is the system space-N');
  for (const { name, value } of contract.shadow.tokens) {
    const token = `--${name}`;
    const light = scopes.light.get(token);
    const dark = scopes.dark.get(token);
    if (!light || normalShadow(light) !== normalShadow(value.light))
      findings.push(`${token} does not match the system's light shadow`);
    if (!dark || normalShadow(dark) !== normalShadow(value.dark))
      findings.push(`${token} does not match the system's dark shadow`);
  }
  return findings;
}

/** The faces index.html names are the system's families. */
function fontFindings(contract, root) {
  const html = readFileSync(join(root, FONT_CONFIG), 'utf8');
  const family = (stack) => /^"([^"]+)"/.exec(stack)?.[1];
  return Object.entries(contract.type.families).flatMap(([role, stack]) => {
    const faces = new RegExp(String.raw`--font-face-${role}:\s*([^;]+);`).exec(html)?.[1] ?? '';
    return faces.includes(`'${family(stack)}'`)
      ? []
      : [`${FONT_CONFIG}: the ${role} face must be ${family(stack)}`];
  });
}

/**
 * globals.css against the system's tokens.json, both themes.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function tokenContractFindings(css, contract) {
  const scopes = declarationsByScope(css);
  return [
    ...colourFindings(contract, scopes),
    ...typeFindings(contract, scopes),
    ...scalarFindings(contract, scopes),
  ];
}

export function tokenContractViolations(root) {
  const contract = readContract(root);
  const css = readFileSync(join(root, ...TOKEN_CSS.split('/')), 'utf8');
  return [
    ...tokenContractFindings(css, contract).map((finding) => `${TOKEN_CSS}: ${finding}`),
    ...fontFindings(contract, root),
  ];
}

/** Every system token name, which the zero-consumer audit treats as the contract. */
export function contractTokenNames(root) {
  const contract = readContract(root);
  return new Set([
    ...contract.color.tokens.map(({ name }) => `--color-${name}`),
    ...contract.type.groups.flatMap((group) =>
      group.styles.flatMap(({ name }) => [
        `--text-${name}`,
        `--text-${name}--line-height`,
        `--text-${name}--font-weight`,
        `--text-${name}--letter-spacing`,
      ]),
    ),
    ...contract.radius.tokens.map(({ name }) => `--${name}`),
    ...contract.shadow.tokens.map(({ name }) => `--${name}`),
  ]);
}
