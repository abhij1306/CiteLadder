import assert from 'node:assert/strict';
import test from 'node:test';

import { appSourceViolations } from '../../frontend/scripts/design-system-source-checks.mjs';

const appCss = "@import 'tailwindcss' source(none);\n@source '../../../components/demand';\n";

test('a component directory imported by listed code must be listed too', () => {
  const violations = appSourceViolations(appCss, [
    {
      label: 'components/demand/projection.tsx',
      source: "import { Setup } from '@/components/integrations/setup';",
    },
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /components\/integrations/);
});

test('listed imports and imports from unlisted code pass', () => {
  assert.deepEqual(
    appSourceViolations(appCss, [
      {
        label: 'components/demand/projection.tsx',
        source: "import { Chart } from '@/components/demand/chart';",
      },
      {
        label: 'components/settings/hero.tsx',
        source: "import { Setup } from '@/components/integrations/setup';",
      },
    ]),
    [],
  );
});
