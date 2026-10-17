/**
 * Shared Vite+ lint and format configuration (Vite+ reads its lint/fmt config
 * from `vite.config.ts` blocks).
 *
 * Consumed by two configs that must not drift:
 * - `frontend/vite.config.ts` -- frontend-scoped `vp lint` / `vp fmt` / `vp test`
 * - root `vite.config.ts` -- repo-root `vp staged` pre-commit hook
 *
 * Plain object literals on purpose: the root config is loaded by the global
 * `vp` binary and must not resolve any installed package.
 *
 * Ignore patterns are root-agnostic (leading doublestar) so the same config
 * matches whether `vp` runs from `frontend/` or the repository root.
 *
 * Oxfmt replaced Prettier and prettier-plugin-tailwindcss; `sortTailwindcss`
 * produces byte-identical ordering to the plugin it replaces, including this
 * project's custom v4 tokens and variant prefixes. `../.gitattributes` pins
 * `eol=lf` because oxfmt always writes LF.
 *
 * The exports are explicitly typed with the same config types Vite+'s
 * `defineConfig` uses: without the annotation, tsc infers huge literals and
 * dies with TS2321 "Excessive stack depth" at the defineConfig call sites.
 * Type-only imports are erased before bundling, so the root config (which is
 * bundled without node_modules resolution) is unaffected.
 */
import type { OxlintConfig } from 'vite-plus/lint';
import type { OxfmtConfig } from 'vite-plus/fmt';

export const lintConfig: OxlintConfig = {
  plugins: ['typescript'],
  // Central strictness contract (previously CLI flags on the lint script):
  // warnings fail the gate and unused-disable directives are errors, for every
  // entry point (`vp check`, `vp lint`, the pre-commit staged command) because
  // CLI flags would otherwise take precedence and scatter the policy.
  // `lint.options.typeAware`/`typeCheck` are deliberately NOT enabled: they are
  // coupled in vite-plus 0.3.1, and verification against this repo surfaced 47
  // pre-existing type-aware findings (mostly deliberate fire-and-forget
  // `router()`/`invalidateQueries()` calls and test stubs). TypeScript
  // diagnostics stay on `tsc --noEmit`; revisit type-aware adoption as a
  // separate change.
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: 'error',
  },
  categories: {
    correctness: 'error',
  },
  env: {
    builtin: true,
    browser: true,
    node: true,
  },
  ignorePatterns: [
    '**/out/**',
    '**/build/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    // Generated service and contract inputs, byte-checked against their
    // generators in CI.
    '**/services/*/src/generated/**',
    '**/packages/*/src/generated/**',
  ],
  rules: {
    'no-array-constructor': 'error',
    'no-unused-expressions': 'warn',
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-promise-executor-return': 'error',
    'no-constant-binary-expression': 'error',
    'no-unsafe-optional-chaining': 'error',
    'typescript/ban-ts-comment': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-misused-new': 'error',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/triple-slash-reference': 'error',
  },
  overrides: [
    {
      files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
      rules: {
        'react/display-name': 'error',
        'react/jsx-key': 'error',
        'react/jsx-no-comment-textnodes': 'error',
        'react/jsx-no-duplicate-props': 'error',
        'react/jsx-no-target-blank': 'off',
        'react/jsx-no-undef': 'error',
        'react/no-children-prop': 'error',
        'react/no-danger-with-children': 'error',
        'react/no-direct-mutation-state': 'error',
        'react/no-find-dom-node': 'error',
        'react/no-is-mounted': 'error',
        'react/no-render-return-value': 'error',
        'react/no-string-refs': 'error',
        'react/no-unescaped-entities': 'error',
        'react/no-unknown-property': 'off',
        'react/no-unsafe': 'off',
        'react/react-in-jsx-scope': 'off',
        'import/no-anonymous-default-export': 'warn',
        'jsx-a11y/alt-text': ['warn', { elements: ['img'], img: ['Image'] }],
        'jsx-a11y/aria-props': 'warn',
        'jsx-a11y/aria-proptypes': 'warn',
        'jsx-a11y/aria-unsupported-elements': 'warn',
        'jsx-a11y/role-has-required-aria-props': 'warn',
        'jsx-a11y/role-supports-aria-props': 'warn',
        'react/rules-of-hooks': 'error',
        'react/exhaustive-deps': 'warn',
        'react/static-components': 'error',
        'react/use-memo': 'error',
        'react/preserve-manual-memoization': 'error',
        'react/incompatible-library': 'warn',
        'react/immutability': 'error',
        'react/globals': 'error',
        'react/refs': 'error',
        'react/set-state-in-effect': 'error',
        'react/error-boundaries': 'error',
        'react/purity': 'error',
        'react/set-state-in-render': 'error',
        'react/unsupported-syntax': 'warn',
      },
      plugins: ['react', 'import', 'jsx-a11y'],
      env: {
        node: true,
      },
    },
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      rules: {
        'constructor-super': 'off',
        'getter-return': 'off',
        'no-class-assign': 'off',
        'no-const-assign': 'off',
        'no-dupe-class-members': 'off',
        'no-dupe-keys': 'off',
        'no-func-assign': 'off',
        'no-import-assign': 'off',
        'no-new-native-nonconstructor': 'off',
        'no-obj-calls': 'off',
        'no-redeclare': 'off',
        'no-setter-return': 'off',
        'no-this-before-super': 'off',
        'no-unreachable': 'off',
        'no-unsafe-negation': 'off',
        'no-var': 'error',
        'no-with': 'off',
        'prefer-const': 'error',
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
      },
    },
  ],
};

export const fmtConfig: OxfmtConfig = {
  printWidth: 100,
  singleQuote: true,
  sortPackageJson: false,
  sortTailwindcss: {},
  ignorePatterns: [
    '**/node_modules/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/pnpm-lock.yaml',
    // Generated service and contract inputs, byte-checked against their
    // generators in CI.
    '**/services/*/src/generated/**',
    '**/packages/*/src/generated/**',
    // Re-wrapping this inflates it past the owner line budget that
    // check-frontend-architecture.mjs enforces; kept hand-formatted.
    '**/apps/app/src/globals.css',
  ],
};
