import { fmtConfig, lintConfig } from './frontend/vp-shared-config.ts';

const config = {
  lint: lintConfig,
  fmt: fmtConfig,
  staged: {
    '*.{js,jsx,mjs,ts,tsx,mts,cts,css,json}': 'vp check --fix',
    // The design-system policy judges the whole tree (token contrast, Tailwind
    // @source), so it runs once per commit. A function task gets no staged
    // paths appended; a long path list would otherwise split it into parallel
    // duplicate runs.
    'frontend/**/*.{css,ts,tsx,astro}': () => 'node frontend/scripts/check-design-system.mjs',
    '**/*.{js,jsx,mjs,cjs,ts,tsx,css,json}': () =>
      'node frontend/scripts/check-token-size.mjs --staged',
  },
};

export default config;
