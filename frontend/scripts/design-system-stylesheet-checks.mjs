import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapeRegExp } from './design-system-class-data.mjs';
import { TOKEN_CSS } from './design-system-source-checks.mjs';

/** Shared token completeness and relative scale consistency; absolute appearance is free to change. */
export function productContractViolations(root) {
  const violations = [];
  const css = readFileSync(join(root, ...TOKEN_CSS.split('/')), 'utf8');
  // Every role the product builds on has to be defined somewhere. The value is
  // the design system's to choose: pinning `--color-accent` to a literal hex
  // meant a rebrand failed a test rather than a review.
  // The system's own tokens are pinned by design-system-contract.mjs; these are
  // the component geometry roles the product derives from them.
  const requiredTokens = [
    '--content-gutter',
    '--content-max-width',
    '--workspace-gap',
    '--compact-gap',
    '--page-section-gap',
    '--card-padding',
    '--modal-padding',
    '--nav-item-height',
    '--menu-item-height',
    '--tab-height',
    '--badge-height-sm',
    '--table-row-height',
    '--table-header-height',
  ];
  for (const token of requiredTokens) {
    if (!new RegExp(escapeRegExp(token) + String.raw`\s*:\s*[^;]+;`).test(css)) {
      violations.push(`${TOKEN_CSS}: ${token} must be defined`);
    }
  }
  // The type ladder is ordered even though its absolute sizes are free.
  const TYPE_SCALE = [
    '--text-caption',
    '--text-body-sm',
    '--text-body',
    '--text-body-lg',
    '--text-lead',
    '--text-title',
    '--text-display-md',
    '--text-display-lg',
    '--text-display-xl',
    '--text-display-2xl',
  ];
  const scale = TYPE_SCALE.map((token) => {
    const match = new RegExp(escapeRegExp(token) + String.raw`\s*:\s*([\d.]+)px`).exec(css);
    return { token, size: match ? Number(match[1]) : null };
  });
  for (const { token, size } of scale) {
    if (size === null) violations.push(`${TOKEN_CSS}: ${token} must be a px size`);
  }
  const sized = scale.filter((step) => step.size !== null);
  for (let index = 1; index < sized.length; index += 1) {
    if (sized[index].size <= sized[index - 1].size) {
      violations.push(
        `${TOKEN_CSS}: ${sized[index].token} must be larger than ${sized[index - 1].token}`,
      );
    }
  }
  if (/\.website-type\b/.test(css)) {
    violations.push(`${TOKEN_CSS}: retired .website-type palette boundary must not return`);
  }
  // The class itself is gone from the shell, so guarding only the palette-override
  // shape would be an assertion that can never fire. Keep the namespace retired.
  if (/\.product-app\b/.test(css)) {
    violations.push(`${TOKEN_CSS}: the retired product-app palette scope must not return`);
  }

  return violations;
}
